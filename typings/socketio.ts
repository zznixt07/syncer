
type TResult = {
	success: boolean
	data: any
}

interface IRoomInfo {
	roomName: string
}

export interface IRoomAndData extends IRoomInfo {
	data: Record<string, any>
}

// Used for create_room to support reclamation with ownerToken
interface ICreateRoomData extends IRoomInfo {
	data?: {
		ownerToken?: string
		[key: string]: any
	}
}

export interface IJoinRoomData extends IRoomInfo {
	data: {
		ownerToken?: string
	}
}

export interface ServerToClientEvents {
	noArg: () => void
	basicEmit: (a: number, b: string, c: Buffer) => void
	withAck: (d: string, callback: (e: number) => void) => void
	list_rooms: (a: (msg: TResult) => void) => void
	stream_change: (data: any) => void
	media_event: (data: any) => void
	sync_room_data: (data: any) => void
	// stream_location: (ack: (data: TResult) => void) => void
}

export interface ClientToServerEvents {
	time_sync: (data: Record<any, any>, ack: (msg: {serverTime: number}) => void) => void
	list_rooms: (ack: (msg: TResult) => void) => void
	create_room: (data: ICreateRoomData, ack: (msg: TResult) => void) => void
	join_room: (data: IJoinRoomData, ack: (msg: TResult) => void) => void
	leave_room: (data: IRoomInfo, ack: (msg: TResult) => void) => void
	media_event: (data: IRoomAndData) => void
	stream_change: (data: IRoomAndData) => void
	sync_room_data: (data: IRoomInfo) => void
	// stream_location: (data: IRoomAndData) => void
}

export interface InterServerEvents {
	ping: () => void
}

export interface SocketData {
	name: string
	age: number

}
