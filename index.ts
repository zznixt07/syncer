import { createServer } from 'http'
import { Server } from 'socket.io'
import express, {Express} from 'express'
import { ClientToServerEvents, InterServerEvents, ServerToClientEvents, SocketData } from 'typings/socketio'

const app = express()

const initWebSocket = (app: Express) => {
	const httpServer = createServer(app)
	const io = new Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>(httpServer, {
		cors: {
			origin: '*',
		},
	})
    return httpServer
}

const httpServer = initWebSocket(app)
const PORT = parseInt(process.env.PORT!, 10)
httpServer.listen(PORT, async () => {
	console.log(`
	⚡️[TCP]: Server is running at http://localhost:${PORT}
	🔌[WS ]: Server is running at http://localhost:${PORT}`)
})
export { app }
