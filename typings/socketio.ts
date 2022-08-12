export interface ServerToClientEvents {
	noArg: () => void
	basicEmit: (a: number, b: string, c: Buffer) => void
	withAck: (d: string, callback: (e: number) => void) => void
	list_rooms: (a: any) => void
	room_stream_change: (data: any) => void
	media_event: (data: any) => void
	sync_room_data: (data: any) => void
}

type TResult = {
	success: boolean
	data: any
}

export interface ClientToServerEvents {
	list_rooms: (ack: (msg: TResult) => void) => void
	create_room: (data: any, ack: (msg: TResult) => void) => void
	list_room_data: (data: any) => void
	room_stream_change: (data: any) => void
	join_room: (data: any, ack: (msg: TResult) => void) => void
	leave_room: (ack: (msg: TResult) => void) => void
	media_event: (data: any) => void
	set_room_data: (data: any) => void
	sync_room_data: (data: any) => void
}

export interface InterServerEvents {
	ping: () => void
}

export interface SocketData {
	name: string
	age: number

}
