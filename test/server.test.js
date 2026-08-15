const { after, before, test } = require('node:test')
const assert = require('node:assert/strict')
const { io: connect } = require('socket.io-client')
const { cleanupStaleRooms, createSyncServer, isPlaybackEnvelopeV2 } = require('../dist/index.js')

let syncServer
let address
const clients = []

const openClient = async () => {
	const socket = connect(address, {
		transports: ['websocket'],
		forceNew: true,
		reconnection: false,
	})
	clients.push(socket)
	await new Promise((resolve, reject) => {
		socket.once('connect', resolve)
		socket.once('connect_error', reject)
	})
	return socket
}

const emitAck = (socket, event, data) =>
	new Promise((resolve) => socket.emit(event, data, resolve))

const once = (socket, event) =>
	new Promise((resolve) => socket.once(event, resolve))

const envelope = (overrides = {}) => ({
	version: 2,
	capturedAtMs: 1000,
	source: { platform: 'desktop', adapter: 'html', service: 'web' },
	media: { canonicalId: 'fixture:one', url: 'https://fixture.test/one', isLive: false },
	playback: { state: 'play', positionMs: 12_500, rate: 1 },
	capabilities: { canPlay: true, canPause: true, canSeek: true, canSetRate: true, canLoadMedia: true },
	...overrides,
})

before(async () => {
	syncServer = createSyncServer()
	await new Promise((resolve) => syncServer.httpServer.listen(0, '127.0.0.1', resolve))
	const port = syncServer.httpServer.address().port
	address = `http://127.0.0.1:${port}`
})

after(async () => {
	clients.forEach((socket) => socket.disconnect())
	await new Promise((resolve) => syncServer.io.close(resolve))
})

test('validates all required protocol-v2 sections', () => {
	assert.equal(isPlaybackEnvelopeV2(envelope()), true)
	assert.equal(isPlaybackEnvelopeV2({ ...envelope(), playback: { state: 'play', rate: 1 } }), false)
	assert.equal(isPlaybackEnvelopeV2({ ...envelope(), capabilities: { canPlay: true } }), false)
	assert.equal(isPlaybackEnvelopeV2({ ...envelope(), version: 1 }), false)
})

test('seeds stream and playback replay from a browser host create snapshot', async () => {
	const host = await openClient()
	const initial = envelope({
		capturedAtMs: 1500,
		media: { canonicalId: 'youtube:seed', url: 'https://www.youtube.com/watch?v=seed', isLive: false },
	})
	const created = await emitAck(host, 'create_room', {
		roomName: 'seeded-room',
		data: { ...initial, ownerToken: 'stale-presented-token' },
	})
	assert.equal(created.success, true)

	const guest = await openClient()
	const order = []
	guest.on('stream_change', (event) => order.push(['stream', event]))
	guest.on('media_event', (event) => order.push(['media', event]))
	await emitAck(guest, 'join_room', { roomName: 'seeded-room', data: {} })
	await new Promise((resolve) => setTimeout(resolve, 30))

	assert.deepEqual(order.map(([kind]) => kind), ['stream', 'media'])
	assert.equal(order[0][1].data.media.url, initial.media.url)
	assert.equal(order[0][1].data.sequence, 1)
	assert.equal(order[1][1].data.sequence, 2)
	assert.equal('ownerToken' in order[0][1].data, false)
})

test('rejects legacy flat payloads without assigning sequence or storing snapshots', async () => {
	const host = await openClient()
	const created = await emitAck(host, 'create_room', { roomName: 'legacy', data: {} })
	assert.equal(created.success, true)

	const firstGuest = await openClient()
	await emitAck(firstGuest, 'join_room', { roomName: 'legacy', data: {} })
	let received = false
	firstGuest.once('media_event', () => { received = true })
	host.emit('media_event', {
		roomName: 'legacy',
		data: { timestamp: 12.5, tms: 1000, mediaState: 'play', playbackRate: 1 },
	})
	await new Promise((resolve) => setTimeout(resolve, 30))
	assert.equal(received, false)
	assert.equal(syncServer.rooms.get('legacy').latestMediaEvent, null)
	assert.equal(syncServer.rooms.get('legacy').nextSequence, 1)
})

test('preserves v2 fields, assigns sequence, and replays stream before playback', async () => {
	const host = await openClient()
	await emitAck(host, 'create_room', { roomName: 'v2-room', data: {} })

	host.emit('stream_change', {
		roomName: 'v2-room',
		data: envelope({
			sequence: 999,
			capturedAtMs: 2000,
			source: { platform: 'android', adapter: 'media-session' },
			media: { canonicalId: 'track:1', isLive: false },
			playback: { state: 'pause', positionMs: 0, rate: 1 },
			capabilities: { canPlay: true, canPause: true, canSeek: true, canSetRate: false, canLoadMedia: false },
		}),
	})
	host.emit('media_event', {
		roomName: 'v2-room',
		data: envelope({
			capturedAtMs: 2100,
			source: { platform: 'android', adapter: 'media-session' },
			media: { canonicalId: 'track:1', isLive: false },
			playback: { state: 'play', positionMs: 500, rate: 1 },
			capabilities: { canPlay: true, canPause: true, canSeek: true, canSetRate: false, canLoadMedia: false },
		}),
	})

	const guest = await openClient()
	const order = []
	guest.on('stream_change', (event) => order.push(['stream', event]))
	guest.on('media_event', (event) => order.push(['media', event]))
	await emitAck(guest, 'join_room', { roomName: 'v2-room', data: {} })
	await new Promise((resolve) => setTimeout(resolve, 30))
	assert.deepEqual(order.map(([kind]) => kind), ['stream', 'media'])
	assert.equal(order[0][1].data.sequence, 1)
	assert.equal(order[1][1].data.sequence, 2)
	assert.equal(order[1][1].data.version, 2)
})

test('removes only rooms whose disconnected owner is stale', () => {
	const rooms = new Map([
		['stale', { id: null, ownerToken: 'a', disconnectedAt: 100, nextSequence: 1, latestMediaEvent: null, latestStreamChange: null }],
		['recent', { id: null, ownerToken: 'b', disconnectedAt: 950, nextSequence: 1, latestMediaEvent: null, latestStreamChange: null }],
		['active', { id: 'socket', ownerToken: 'c', disconnectedAt: null, nextSequence: 1, latestMediaEvent: null, latestStreamChange: null }],
	])
	cleanupStaleRooms(rooms, 1000, 500)
	assert.deepEqual([...rooms.keys()], ['recent', 'active'])
})

test('rejects guest playback events and supports owner token reclaim', async () => {
	const host = await openClient()
	const created = await emitAck(host, 'create_room', { roomName: 'owned', data: {} })
	const token = created.data.ownerToken
	const guest = await openClient()
	await emitAck(guest, 'join_room', { roomName: 'owned', data: {} })

	guest.emit('media_event', {
		roomName: 'owned',
		data: envelope({ playback: { state: 'play', positionMs: 99_000, rate: 1 } }),
	})
	await new Promise((resolve) => setTimeout(resolve, 20))
	assert.equal(syncServer.rooms.get('owned').latestMediaEvent, null)

	await emitAck(host, 'leave_room', { roomName: 'owned' })
	const reclaimed = await emitAck(host, 'join_room', {
		roomName: 'owned',
		data: { ownerToken: token },
	})
	assert.equal(reclaimed.success, true)
	assert.equal(reclaimed.data.isOwner, true)
	assert.equal(syncServer.rooms.get('owned').id, host.id)
})

test('leaves a whitespace-padded room and can join another room afterward', async () => {
	const firstHost = await openClient()
	const secondHost = await openClient()
	const createdFirst = await emitAck(firstHost, 'create_room', { roomName: '  padded-room  ', data: {} })
	const createdSecond = await emitAck(secondHost, 'create_room', { roomName: 'next-room', data: {} })
	assert.equal(createdFirst.success, true)
	assert.equal(createdSecond.success, true)
	assert.equal(syncServer.rooms.has('padded-room'), true)
	assert.equal(syncServer.rooms.has('  padded-room  '), false)

	const left = await emitAck(firstHost, 'leave_room', { roomName: '  padded-room  ' })
	assert.equal(left.success, true)

	const joined = await emitAck(firstHost, 'join_room', { roomName: 'next-room', data: {} })
	assert.equal(joined.success, true)
})

/*
Room state lives in this process's memory, so a handler that throws does not
cost one packet — pm2 restarts and every room, for every user, is gone. That is
what happened in production: a browser emitted media_event with roomName null.
These tests are about survival, not about what the server answers.
*/
test('survives malformed packets from a hostile client', async () => {
	const attacker = await openClient()
	const junk = [
		['media_event', { roomName: null, data: envelope() }],
		['media_event', { roomName: 42, data: envelope() }],
		['media_event', undefined],
		['media_event', { data: envelope() }],
		['stream_change', { roomName: null, data: envelope() }],
		['stream_change', undefined],
		['sync_room_data', undefined],
		['sync_room_data', { roomName: null }],
		['leave_room', undefined],
		['create_room', undefined],
		['join_room', undefined],
	]
	for (const [event, payload] of junk) attacker.emit(event, payload)

	// Handlers that ack are reached with ack === undefined when no callback is
	// passed, which used to be a TypeError of its own.
	attacker.emit('create_room', { roomName: 'no-ack-room' })
	attacker.emit('join_room', { roomName: 'no-ack-room', data: {} })
	attacker.emit('leave_room', { roomName: 'no-ack-room' })
	attacker.emit('list_rooms')
	attacker.emit('time_sync', {})

	await new Promise((resolve) => setTimeout(resolve, 50))
	assert.equal(attacker.connected, true, 'the hostile client should not have been dropped')

	// The point of all of the above: the server is still serving everyone else.
	const host = await openClient()
	const created = await emitAck(host, 'create_room', { roomName: 'still-alive', data: {} })
	assert.equal(created.success, true)
	const guest = await openClient()
	await emitAck(guest, 'join_room', { roomName: 'still-alive', data: {} })
	const relayed = once(guest, 'media_event')
	host.emit('media_event', { roomName: 'still-alive', data: envelope({ capturedAtMs: 4000 }) })
	assert.equal((await relayed).data.playback.positionMs, 12_500)
})

test('lists public rooms with live user counts', async () => {
	const client = await openClient()
	const result = await new Promise((resolve) => client.emit('list_rooms', resolve))
	assert.equal(result.success, true)
	assert.ok(result.data.rooms.includes('legacy'))
	assert.ok(result.data.roomUserCounts.some((room) => room.roomName === 'v2-room'))
})
