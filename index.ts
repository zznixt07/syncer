import { createServer } from 'http'
import { Server, Socket } from 'socket.io'
import express, { Express } from 'express'
import {
	ClientToServerEvents,
	InterServerEvents,
	ServerToClientEvents,
	SocketData,
} from 'typings/socketio'

const app = express()

const initWebSocket = (app: Express) => {
	const httpServer = createServer(app)
	const io = new Server<
		ClientToServerEvents,
		ServerToClientEvents,
		InterServerEvents,
		SocketData
	>(httpServer, {
		cors: {
			origin: '*',
		},
	})
	// this is a global variable that stores the room name in its key
	// and the current room status in its value.
	const rooms: Map<string, Object> = new Map()
	const mediaHandler = (roomName: string, socket: Socket, data: any) => {
		// there is no ack but an emit, so that the other clients
		// can recieve any event just by slistening. an ack would not be
		// suitable here.
		// console.log('media_event', data)
		socket.to(roomName).emit('media_event', data)
	}
	io.on('connection', (socket) => {
		console.log('a user connected')
		socket.on('create_room', (roomInfo, ack) => {
			const roomName = roomInfo.name
			if (!rooms.has(roomName)) {
				socket.join(roomName)
				rooms.set(roomName, {})
				ack({ success: true, data: 'Room created successfully.' })
			} else {
				return ack({ success: false, data: 'Room already exists.' })
			}
			// socket.on('set_room_data', (data) => {
			//     socket.to(roomName).emit('sync_room_data', data)
			// })
            /* 
                this listen event is nested inside the create_room event so that
                only the users that have joined the room can receive the event instead
                of all the users.
                DO not use this in join_room cuz it will trip an infinite loop.
                No workaround around this yet. need a way to distinguish JS click and real click.
             */
			socket.on('media_event', (data) => {
                console.log('media_event')
                mediaHandler(roomName, socket, data)
            })
            const leaveAndDeleteRoom = () => {
                console.log('room creator disconnected. deleting room.')
                socket.leave(roomName)
                rooms.delete(roomName)
            }
            socket.on('disconnect', leaveAndDeleteRoom)
            socket.on('leave_room', (ack) => {
                leaveAndDeleteRoom()
                ack({ success: true, data: 'Room left and deleted successfully.' })
            })
		})
		socket.on('join_room', (targetRoom, ack) => {
            const roomName = targetRoom.name
			if (!rooms.has(roomName)) {
                return ack({ success: false, data: 'Room does not exist.' })
			} else {
                if (socket.rooms.has(roomName)) {
                    return ack({ success: false, data: 'Room already connected.' })
				}
				socket.join(roomName)
				ack({ success: true, data: 'Room joined successfully.' })
				// then send the current status of room to the joinee ??
				// socket.emit('sync_room_data', {})
			}
            
			socket.on('leave_room', (ack) => {
				const roomName = targetRoom.name
				if (!rooms.has(roomName)) {
					return ack({ success: false, data: 'Room does not exist.' })
				} else {
					if (!socket.rooms.has(roomName)) {
						return ack({ success: false, data: 'Room not connected.' })
					}
					socket.leave(roomName)
					ack({ success: true, data: 'Room left successfully.' })
					// socket.removeAllListeners('media_event')
				}
			})
		})

		// maybe keep this inside create_room
		socket.on('room_stream_change', (roomInfo) => {
			socket.to(roomInfo.name).emit('room_stream_change', roomInfo)
		})
		socket.on('list_rooms', (ack) => {
			const roomNames = Array.from(rooms.keys())
			ack({
				success: true,
				data: roomNames,
			})
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
