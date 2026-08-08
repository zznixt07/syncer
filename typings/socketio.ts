export type PlaybackStateName = 'play' | 'pause' | 'buffer' | 'ended'

export interface MediaIdentity {
	canonicalId?: string
	url?: string
	title?: string
	artist?: string
	durationMs?: number
	isLive: boolean
}

export interface PlaybackCapabilities {
	canPlay: boolean
	canPause: boolean
	canSeek: boolean
	canSetRate: boolean
	canLoadMedia: boolean
}

export interface PlaybackEnvelopeV2 {
	version: 2
	sequence?: number
	capturedAtMs: number
	source: {
		platform: 'desktop' | 'android' | 'ios'
		adapter: 'html' | 'media-session' | 'youtube' | 'spotify'
		service?: string
		applicationId?: string
	}
	media: MediaIdentity
	playback: {
		state: PlaybackStateName
		positionMs: number
		rate: number
		muted?: boolean
	}
	capabilities: PlaybackCapabilities
}

export type PlaybackPayload = PlaybackEnvelopeV2

export type TResult = {
	success: boolean
	data: Record<string, unknown>
}

export interface IRoomInfo {
	roomName: string
}

export interface IRoomAndData extends IRoomInfo {
	data: PlaybackPayload
}

export interface ICreateRoomData extends IRoomInfo {
	data?: Partial<PlaybackEnvelopeV2> & {
		ownerToken?: string
		[key: string]: unknown
	}
}

export interface IJoinRoomData extends IRoomInfo {
	data: {
		ownerToken?: string
	}
}

export interface ServerToClientEvents {
	stream_change: (data: IRoomAndData) => void
	media_event: (data: IRoomAndData) => void
	sync_room_data: (data: Record<string, never>) => void
	room_user_count: (data: { roomName: string; userCount: number }) => void
}

export interface ClientToServerEvents {
	time_sync: (
		data: Record<string, unknown>,
		ack: (msg: { serverTime: number }) => void
	) => void
	list_rooms: (ack: (msg: TResult) => void) => void
	create_room: (data: ICreateRoomData, ack: (msg: TResult) => void) => void
	join_room: (data: IJoinRoomData, ack: (msg: TResult) => void) => void
	leave_room: (data: IRoomInfo, ack: (msg: TResult) => void) => void
	media_event: (data: IRoomAndData) => void
	stream_change: (data: IRoomAndData) => void
	sync_room_data: (data: IRoomInfo) => void
}

export interface InterServerEvents {
	ping: () => void
}

export interface SocketData {
	name?: string
	age?: number
}
