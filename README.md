# Syncer server

Socket.IO room coordinator for the Syncer desktop extension and mobile prototype.

## Protocol v2

The server preserves the original Socket.IO event names but accepts only complete protocol-v2 playback envelopes. It rejects legacy flat payloads, assigns room-scoped sequence numbers, caches the latest stream and playback state, and replays that state to joining or reconnecting guests. Only the room owner socket may publish playback events.

Rooms remain public and account-free. Owner tokens allow host reclaim; orphaned and empty rooms are removed by the stale-room cleanup loop.

## Commands

```sh
npm install
npm run build
npm test
npm start
```

`npm test` covers ownership, strict v2 validation, sequence assignment and replay, owner reclaim, and public room listing.
