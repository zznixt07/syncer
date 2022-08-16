import { createServer } from 'http'
import { Server, Socket } from 'socket.io'
import express, { Express } from 'express'
import {
	ClientToServerEvents,
	InterServerEvents,
	ServerToClientEvents,
	SocketData,
} from 'typings/socketio'
import 'dotenv/config'

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
	// and the owners socket#id in its value
	const rooms: Map<string, any> = new Map()
	const mediaHandler = (roomName: string, socket: Socket, data: any) => {
		// there is no ack but an emit, so that the other clients
		// can recieve any event just by listening. an ack would not be
		// suitable here.
		// .to() doesnt send to sender, which is the thing preventing this from
		// going infinite loop.
		socket.to(roomName).emit('media_event', data)
	}
	const leaveAndDeleteRoom = (roomName: string, socket: Socket) => {
		socket.leave(roomName)
		rooms.delete(roomName)
	}

	const requestMediaEvent = (ownerSocketId: string) => {
		io.to(ownerSocketId).emit('sync_room_data', {})
	}
	io.on('connection', (socket) => {
		console.log('a user connected')
		socket.on('create_room', (roomInfo, ack) => {
			// if the socket id is connected to other rooms not including itself.
			// then return.
			if (io.of('/').adapter.sids.get(socket.id)!.size > 1) {
				return ack({
					success: false,
					data: {message: 'Leave current room first.'},
				})
			}
			const roomName = roomInfo.roomName
			if (rooms.has(roomName)) {
				return ack({ success: false, data: {message: 'Room already exists.'} })
			} else {
				socket.join(roomName)
				rooms.set(roomName, {
					id: socket.id,
				})
				ack({ success: true, data: {message: 'Room created successfully.'} })
			}
			// also broadcast to any clients which are in the room. It is possible
			// to have clients still connected if the owner leaves and deletes the room first.
			mediaHandler(roomName, socket, roomInfo)
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
						message:
							'Leave current room first.',
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
				requestMediaEvent(rooms.get(roomName).id)
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
			requestMediaEvent(room.id)
		})

		socket.on('list_rooms', (ack) => {
			const roomNames = Array.from(rooms.keys())
			ack({
				success: true,
				data: {rooms: roomNames},
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
			if (socket.id === rooms.get(roomName)?.id) {
				isOwner = true
			}
			ack({
				success: true,
				data: { isOwner: isOwner, message: 'Room left successfully.' },
			})
		})

		socket.on('disconnect', () => {
			console.log('room creator disconnected. deleting room.')
			// since, we dont get any data from client, use socket.id
			for (const [roomName, roomInfo] of rooms) {
				if (roomInfo.id === socket.id) {
					leaveAndDeleteRoom(roomName, socket)
					// dont break; in the case(possible?) of multiple rooms with same owner
				}
			}
		})
	})
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
