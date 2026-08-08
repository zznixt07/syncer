import { createServer, Server as HttpServer } from 'http'
import { Server, Socket } from 'socket.io'
import express, { Express } from 'express'
import { randomBytes } from 'crypto'
import {
	ClientToServerEvents,
	InterServerEvents,
	IRoomAndData,
	PlaybackPayload,
	ServerToClientEvents,
	SocketData,
} from 'typings/socketio'
import 'dotenv/config'

export interface RoomInfo {
	id: string | null
	ownerToken: string
	disconnectedAt: number | null
	nextSequence: number
	latestMediaEvent: IRoomAndData | null
	latestStreamChange: IRoomAndData | null
}

const MAX_ROOM_AGE_MS = 86400 * 3 * 1000

export const cleanupStaleRooms = (
	rooms: Map<string, RoomInfo>,
	now = Date.now(),
	maxAgeMs = MAX_ROOM_AGE_MS,
) => {
	for (const [roomName, room] of rooms) {
		if (room.disconnectedAt && now - room.disconnectedAt > maxAgeMs) rooms.delete(roomName)
	}
}

export interface SyncServer {
	httpServer: HttpServer
	io: Server<
		ClientToServerEvents,
		ServerToClientEvents,
		InterServerEvents,
		SocketData
	>
	rooms: Map<string, RoomInfo>
}

const decoratePayload = (room: RoomInfo, payload: PlaybackPayload) => {
	const sequence = room.nextSequence++
	return {
		...payload,
		sequence,
		capturedAtMs:
			typeof payload.capturedAtMs === 'number'
				? payload.capturedAtMs
				: typeof payload.tms === 'number'
				? payload.tms
				: Date.now(),
	}
}

export const createSyncServer = (app: Express = express()): SyncServer => {
	const httpServer = createServer(app)
	const io = new Server<
		ClientToServerEvents,
		ServerToClientEvents,
		InterServerEvents,
		SocketData
	>(httpServer, {
		serveClient: false,
		cors: { origin: '*' },
	})
	const rooms: Map<string, RoomInfo> = new Map()

	const getRoomUserCount = (roomName: string) =>
		io.of('/').adapter.rooms.get(roomName)?.size ?? 0

	const notifyRoomUserCount = (roomName: string) => {
		io.to(roomName).emit('room_user_count', {
			roomName,
			userCount: getRoomUserCount(roomName),
		})
	}

	const requestMediaEvent = (ownerSocketId: string) => {
		io.to(ownerSocketId).emit('sync_room_data', {})
	}

	const replaySnapshot = (socket: Socket<ClientToServerEvents, ServerToClientEvents>, room: RoomInfo) => {
		if (room.latestStreamChange) socket.emit('stream_change', room.latestStreamChange)
		if (room.latestMediaEvent) socket.emit('media_event', room.latestMediaEvent)
		return !!(room.latestStreamChange || room.latestMediaEvent)
	}

	io.on('connection', (socket) => {
		socket.on('time_sync', (_, ack) => ack({ serverTime: Date.now() }))

		socket.on('create_room', (roomInfo, ack) => {
			if (io.of('/').adapter.sids.get(socket.id)!.size > 1) {
				return ack({ success: false, data: { message: 'Leave current room first.' } })
			}
			const roomName = roomInfo.roomName.trim()
			if (!roomName) {
				return ack({ success: false, data: { message: 'Room name must be at least 1 character long.' } })
			}
			if (rooms.has(roomName)) {
				return ack({ success: false, data: { message: 'Room already exists.' } })
			}

			const ownerToken = randomBytes(16).toString('hex')
			socket.join(roomName)
			rooms.set(roomName, {
				id: socket.id,
				ownerToken,
				disconnectedAt: null,
				nextSequence: 1,
				latestMediaEvent: null,
				latestStreamChange: null,
			})
			ack({
				success: true,
				data: {
					message: 'Room created successfully.',
					ownerToken,
					userCount: getRoomUserCount(roomName),
				},
			})
			notifyRoomUserCount(roomName)
		})

		socket.on('media_event', (incoming) => {
			const room = rooms.get(incoming.roomName)
			if (!room || socket.id !== room.id || !socket.rooms.has(incoming.roomName)) return
			const event = {
				roomName: incoming.roomName,
				data: decoratePayload(room, incoming.data),
			}
			room.latestMediaEvent = event
			socket.to(incoming.roomName).emit('media_event', event)
		})

		socket.on('stream_change', (incoming) => {
			const room = rooms.get(incoming.roomName)
			if (!room || socket.id !== room.id || !socket.rooms.has(incoming.roomName)) return
			const event = {
				roomName: incoming.roomName,
				data: decoratePayload(room, incoming.data),
			}
			room.latestStreamChange = event
			socket.to(incoming.roomName).emit('stream_change', event)
		})

		socket.on('join_room', (targetRoom, ack) => {
			if (io.of('/').adapter.sids.get(socket.id)!.size > 1) {
				return ack({ success: false, data: { message: 'Leave current room first.' } })
			}
			const roomName = targetRoom.roomName.trim()
			const room = rooms.get(roomName)
			if (!room) return ack({ success: false, data: { message: 'Room does not exist.' } })
			if (socket.rooms.has(roomName)) {
				return ack({ success: false, data: { message: 'Room already connected.' } })
			}

			const reclaiming = targetRoom.data?.ownerToken === room.ownerToken
			if (reclaiming) {
				room.id = socket.id
				room.disconnectedAt = null
			}
			socket.join(roomName)
			ack({
				success: true,
				data: {
					message: reclaiming ? 'Room reclaimed.' : 'Room joined successfully.',
					isOwner: reclaiming,
					userCount: getRoomUserCount(roomName),
				},
			})
			notifyRoomUserCount(roomName)

			if (reclaiming) {
				requestMediaEvent(socket.id)
			} else if (!replaySnapshot(socket, room) && room.id) {
				requestMediaEvent(room.id)
			}
		})

		socket.on('sync_room_data', ({ roomName }) => {
			const room = rooms.get(roomName)
			if (room?.id) requestMediaEvent(room.id)
		})

		socket.on('list_rooms', (ack) => {
			const roomNames = Array.from(rooms.keys())
			ack({
				success: true,
				data: {
					rooms: roomNames,
					roomUserCounts: roomNames.map((roomName) => ({
						roomName,
						userCount: getRoomUserCount(roomName),
						isOwner: rooms.get(roomName)?.id === socket.id,
					})),
				},
			})
		})

		socket.on('leave_room', ({ roomName }, ack) => {
			const room = rooms.get(roomName)
			if (!room) return ack({ success: false, data: { message: 'Room does not exist.' } })
			if (!socket.rooms.has(roomName)) {
				return ack({ success: false, data: { message: 'Room not connected.' } })
			}
			const isOwner = socket.id === room.id
			socket.leave(roomName)
			if (isOwner) {
				room.id = null
				room.disconnectedAt = Date.now()
			}
			ack({
				success: true,
				data: {
					isOwner,
					message: 'Room left successfully.',
					userCount: getRoomUserCount(roomName),
				},
			})
			notifyRoomUserCount(roomName)
		})

		socket.on('disconnecting', () => {
			const connectedRooms = Array.from(socket.rooms).filter((name) => name !== socket.id && rooms.has(name))
			for (const room of rooms.values()) {
				if (room.id === socket.id) {
					room.id = null
					room.disconnectedAt = Date.now()
				}
			}
			setTimeout(() => connectedRooms.forEach(notifyRoomUserCount), 0)
		})
	})

	const cleanupTimer = setInterval(() => {
		cleanupStaleRooms(rooms)
	}, 60 * 60 * 1000)
	cleanupTimer.unref()

	return { httpServer, io, rooms }
}

export const app = express()

if (require.main === module) {
	const { httpServer } = createSyncServer(app)
	const port = Number.parseInt(process.env.PORT || '3000', 10)
	httpServer.listen(port, () => {
		console.log(`Syncer HTTP/WebSocket server listening on port ${port}`)
	})
}
