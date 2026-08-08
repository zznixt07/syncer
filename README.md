# Syncer server

Socket.IO room coordinator for the Syncer desktop extension and mobile prototype.

## Protocol compatibility

The server preserves the original event names and flat playback fields. For v2 clients it assigns room-scoped sequence numbers, stamps snapshots in the server clock domain, caches the latest stream and playback state, and replays that state to joining or reconnecting guests. Only the room owner socket may publish playback events.

Rooms remain public and account-free. Owner tokens allow host reclaim; orphaned and empty rooms are removed by the stale-room cleanup loop.

## Commands

```sh
npm install
npm run build
npm test
npm start
```

`npm test` covers ownership, sequence assignment and replay, legacy payload handling, owner reclaim, and public room listing.
