import { createServer } from 'http'
import { Server, Socket } from 'socket.io'
import express, { Express } from 'express'
import { randomBytes } from 'crypto'
import {
	ClientToServerEvents,
	IJoinRoomData,
	InterServerEvents,
	IRoomAndData,
	ServerToClientEvents,
	SocketData,
} from 'typings/socketio'
import 'dotenv/config'
import path from 'path'
import fs from 'fs'

interface RoomInfo {
	id: string | null // null when owner disconnected
	ownerToken: string
	disconnectedAt: number | null
}

const packageJsonPath = path.join(__dirname, 'package.json')
const packageJson = fs.readFileSync(packageJsonPath, 'utf8')
const packageJsonData = JSON.parse(packageJson)
console.log(`version: ${packageJsonData.version}`)

const MAX_ROOM_AGE_MS = 86400 * 3 * 1000

const app = express()

const initWebSocket = (app: Express) => {
	const httpServer = createServer(app)
	const io = new Server<
		ClientToServerEvents,
		ServerToClientEvents,
		InterServerEvents,
		SocketData
	>(httpServer, {
		serveClient: false, // don't serve the static socket.io client file at /socket.io/socket.io.js.
		cors: {
			origin: '*',
		},
	})
	// this is a global variable that stores the room name in its key
	// and the room info (owner socket id, token, disconnection time) in its value
	const rooms: Map<string, RoomInfo> = new Map()
	const mediaHandler = (roomName: string, socket: Socket, data: IRoomAndData) => {
		// there is no ack but an emit, so that the other clients
		// can recieve any event just by listening. an ack would not be
		// suitable here.
		// .to() doesnt send to sender, which is the thing preventing this from
		// going infinite loop.
		socket.to(roomName).emit('media_event', data)
	}
	const requestMediaEvent = (ownerSocketId: string) => {
		io.to(ownerSocketId).emit('sync_room_data', {})
	}
	io.on('connection', (socket) => {
		console.log('a user connected')

		socket.on('time_sync', (_, ack) => {
			const serverTime = Date.now()
			ack({ serverTime: serverTime })
		})
		socket.on('create_room', (roomInfo, ack) => {
			// if the socket id is connected to other rooms not including itself.
			// then return.
			if (io.of('/').adapter.sids.get(socket.id)!.size > 1) {
				return ack({
					success: false,
					data: { message: 'Leave current room first.' },
				})
			}
			const roomName = roomInfo.roomName
			if (roomName.length === 0) {
				return ack({
					success: false,
					data: { message: 'Room name must at least be 1 characters long.' },
				})
			}

			const existingRoom = rooms.get(roomName)
			const providedToken = roomInfo.data?.ownerToken

			if (existingRoom) {
				// Room exists with active owner OR wrong/no token
				return ack({
					success: false,
					data: { message: 'Room already exists.' },
				})
			}

			// Create new room with token
			const newToken = randomBytes(16).toString('hex')
			socket.join(roomName)
			rooms.set(roomName, {
				id: socket.id,
				ownerToken: newToken,
				disconnectedAt: null,
			})
			ack({
				success: true,
				data: { message: 'Room created successfully.', ownerToken: newToken },
			})
			console.log('Room created successfully with id', socket.id)
			
			// also broadcast to any clients which are in the room. It is possible
			// to have clients still connected if the owner leaves a room.
			delete roomInfo.data?.ownerToken
			mediaHandler(roomName, socket, { roomName: roomName, data: {} })
		})
		/* 
			this listen event is nested inside the create_room event so that
			only the users that have joined the room can receive the event instead
			of all the users.
			DO not use this in join_room cuz it will trip an infinite loop.
			Hence, cant implement sending events by anyone to everyone in room.
			No workaround around this yet. need a way to distinguish JS click and real click.
		*/
		socket.on('media_event', (data) => {
			// can either take the room name from the data or invert the rooms map
			// and use the current socket id to get the room name.
			// going with first option cuz `simple is better than complex`.
			if (socket.id === rooms.get(data.roomName)?.id) {
				mediaHandler(data.roomName, socket, data)
			}
		})

		socket.on('stream_change', (newStreamData) => {
			if (socket.id === rooms.get(newStreamData.roomName)?.id) {
				socket.to(newStreamData.roomName).emit('stream_change', newStreamData)
			}
		})

		socket.on('join_room', (targetRoom, ack) => {
			if (io.of('/').adapter.sids.get(socket.id)!.size > 1) {
				return ack({
					success: false,
					data: {
						message: 'Leave current room first.',
					},
				})
			}
			const roomName = targetRoom.roomName
			if (!rooms.has(roomName)) {
				return ack({
					success: false,
					data: { message: 'Room does not exist.' },
				})
			} else {
				if (socket.rooms.has(roomName)) {
					return ack({
						success: false,
						data: { message: 'Room already connected.' },
					})
				}
				const existingRoom = rooms.get(roomName)
				const providedToken = targetRoom.data.ownerToken
				const ownerId = rooms.get(roomName)?.id
				// if (!ownerId) {
				// 	// TODO: instead of doing this, we do similar logic as in create_room event by passing the token in the socket event data.
				// 	// this is a temporary solution to avoid the issue of owner not found.
				// 	// basically, cut and paste the create_room event logic here after implementing it in the frontend extension
				// 	return ack({
				// 		success: false,
				// 		data: { message: 'Room exists but owner not found. (if you are the owner, try creating the room again)' },
				// 	})
				// }

				if (existingRoom) {
					// Room exists — check if it's orphaned and token matches
					if (
						// existingRoom.id === null &&
						providedToken === existingRoom.ownerToken
					) {
						// Reclaim ownership
						existingRoom.id = socket.id
						existingRoom.disconnectedAt = null
						socket.join(roomName)
						ack({
							success: true,
							data: {
								message: 'Room reclaimed.',
								isOwner: true,
							},
						})
						console.log('Room reclaimed successfully with id', socket.id)
						// Broadcast to any clients still in the room
						mediaHandler(roomName, socket, targetRoom)
						return
					}
				}

				socket.join(roomName)
				let isOwner = false
				if (socket.id === rooms.get(roomName)?.id) {
					isOwner = true
				}
				ack({
					success: true,
					data: { isOwner: isOwner, message: 'Room joined successfully.' },
				})
				/*
				then, send the current status of room to the joinee.
				But to do that, we need information from the room creator.
				hence, emit an event only to the room creator.
				In response to the event, the room creator will emit the media_event to the server,
				which will emit the event to *all* the joinee.
				*/
				if (ownerId) {
					requestMediaEvent(ownerId)
				}
			}
		})

		/* socket.on('stream_location', (data) => {
			if (socket.id === rooms.get(data.roomName)?.id) {
				socket
					.to(data.roomName)
					.emit('stream_location', data)
			}
		}) */

		socket.on('sync_room_data', (data) => {
			const roomName = data.roomName
			if (!rooms.has(roomName)) {
				console.log('room does not exist')
				return
			}
			// if (socket.rooms.has(roomName)) {
			// 	console.log('room is not connected to')
			// 	return
			// }
			const room = rooms.get(roomName)
			if (room?.id) {
				requestMediaEvent(room.id)
			}
		})

		socket.on('list_rooms', (ack) => {
			const roomNames = Array.from(rooms.keys())
			ack({
				success: true,
				data: { rooms: roomNames },
			})
		})

		socket.on('leave_room', (roomInfo, ack) => {
			const roomName = roomInfo.roomName
			if (!rooms.has(roomName)) {
				return ack({
					success: false,
					data: { message: 'Room does not exist.' },
				})
			}
			if (!socket.rooms.has(roomName)) {
				return ack({ success: false, data: { message: 'Room not connected.' } })
			}
			socket.leave(roomName)
			// differentiate betn owner leaving and joinee leaving, to remove
			// appropriate client side event listeners.
			let isOwner = false
			let message = 'Room left successfully.'
			if (socket.id === rooms.get(roomName)?.id) {
				isOwner = true
				console.log('owner left room', roomName)
				// do not delete room as owner may want to rejoin and still have owner previlages.
				// i think socket.io automatically handles this.
			}
			ack({
				success: true,
				data: { isOwner: isOwner, message: message },
			})
		})

		socket.on('disconnect', () => {
			// Mark rooms as orphaned instead of deleting immediately
			// This allows the owner to reclaim the room within the timeout period
			for (const [roomName, roomInfo] of rooms) {
				if (roomInfo.id === socket.id) {
					roomInfo.id = null
					roomInfo.disconnectedAt = Date.now()
					console.log(
						`Room "${roomName}" owner disconnected. Room marked as orphaned.`
					)
					// dont break; in the case(possible?) of multiple rooms with same owner
				}
			}
		})
	})

	// Periodic cleanup: delete rooms that have been orphaned for more than 1 day
	setInterval(() => {
		const now = Date.now()
		for (const [roomName, roomInfo] of rooms) {
			if (
				roomInfo.disconnectedAt &&
				now - roomInfo.disconnectedAt > MAX_ROOM_AGE_MS
			) {
				rooms.delete(roomName)
				console.log(`Deleted stale room: ${roomName}`)
			}
		}
	}, 60 * 60 * 1000) // Run cleanup every hour

	return httpServer
}

const httpServer = initWebSocket(app)
const PORT = parseInt(process.env.PORT!, 10)
httpServer.listen(PORT, async () => {
	console.log(`
	⚡️[HTTP] server is running at http://[::]:${PORT}
	🔌[ WS ] server is running at http://[::]:${PORT}
    `)
})
export { app }
