
type TResult = {
	success: boolean
	data: any
}
interface IRoomInfo {
	roomName: string
}

interface IRoomAndData extends IRoomInfo {
	data: Record<string, any>
}

export interface ServerToClientEvents {
	noArg: () => void
	basicEmit: (a: number, b: string, c: Buffer) => void
	withAck: (d: string, callback: (e: number) => void) => void
	list_rooms: (a: (msg: TResult) => void) => void
	room_stream_change: (data: any) => void
	media_event: (data: any) => void
	sync_room_data: (data: any) => void
}

export interface ClientToServerEvents {
	list_rooms: (ack: (msg: TResult) => void) => void
	create_room: (data: IRoomAndData, ack: (msg: TResult) => void) => void
	join_room: (data: IRoomInfo, ack: (msg: TResult) => void) => void
	leave_room: (data: IRoomInfo, ack: (msg: TResult) => void) => void
	media_event: (data: IRoomAndData) => void
	room_stream_change: (data: IRoomAndData) => void
}

export interface InterServerEvents {
	ping: () => void
}

export interface SocketData {
	name: string
	age: number

}
