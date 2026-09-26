// Generates spec/ (HyperSchema types, HyperDB collections, HyperDispatch ops).
// Run `npm run build:db` after editing this file.
const Hyperschema = require('hyperschema')
const HyperdbBuilder = require('hyperdb/builder')
const Hyperdispatch = require('hyperdispatch')

const SCHEMA_DIR = './spec/schema'
const DB_DIR = './spec/db'
const DISPATCH_DIR = './spec/dispatch'

const hyperSchema = Hyperschema.from(SCHEMA_DIR)
const schema = hyperSchema.namespace('p2pcord')

// Space metadata (singleton, id = 'info')
schema.register({
  name: 'info',
  fields: [
    { name: 'id', type: 'string', required: true },
    { name: 'name', type: 'string', required: true },
    { name: 'kind', type: 'uint', required: true }, // 0 = group, 1 = dm
    { name: 'created', type: 'uint', required: true },
    { name: 'root', type: 'buffer' } // key of the first base of this group (stable id across key rotations)
  ]
})

// A member is one writer (device) bound to an identity key by signature
schema.register({
  name: 'member',
  fields: [
    { name: 'writer', type: 'buffer', required: true },
    { name: 'identity', type: 'buffer', required: true },
    { name: 'signature', type: 'buffer', required: true },
    { name: 'name', type: 'string', required: true },
    { name: 'role', type: 'uint', required: true }, // 0 member, 1 admin, 2 owner
    { name: 'joined', type: 'uint', required: true }
  ]
})

schema.register({
  name: 'member-ref',
  fields: [{ name: 'writer', type: 'buffer', required: true }]
})

schema.register({
  name: 'member-role',
  fields: [
    { name: 'writer', type: 'buffer', required: true },
    { name: 'role', type: 'uint', required: true }
  ]
})

schema.register({
  name: 'member-name',
  fields: [{ name: 'name', type: 'string', required: true }]
})

schema.register({
  name: 'channel',
  fields: [
    { name: 'id', type: 'string', required: true },
    { name: 'name', type: 'string', required: true },
    { name: 'kind', type: 'uint', required: true }, // 0 text, 1 voice
    { name: 'position', type: 'uint', required: true }
  ]
})

schema.register({
  name: 'channel-ref',
  fields: [{ name: 'id', type: 'string', required: true }]
})

schema.register({
  name: 'invite',
  fields: [
    { name: 'id', type: 'buffer', required: true },
    { name: 'invite', type: 'buffer', required: true },
    { name: 'publicKey', type: 'buffer', required: true },
    { name: 'expires', type: 'uint', required: true }, // ms epoch, 0 = never
    { name: 'maxUses', type: 'uint', required: true }, // 0 = unlimited
    { name: 'uses', type: 'uint', required: true },
    { name: 'createdBy', type: 'buffer', required: true },
    { name: 'restricted', type: 'bool' } // only identities listed as migrants may use it
  ]
})

schema.register({
  name: 'invite-ref',
  fields: [{ name: 'id', type: 'buffer', required: true }]
})

schema.register({
  name: 'file',
  fields: [
    { name: 'core', type: 'buffer', required: true },
    { name: 'blockOffset', type: 'uint', required: true },
    { name: 'blockLength', type: 'uint', required: true },
    { name: 'byteOffset', type: 'uint', required: true },
    { name: 'byteLength', type: 'uint', required: true },
    { name: 'name', type: 'string', required: true },
    { name: 'mime', type: 'string', required: true }
  ]
})

// id is a time-sortable string, so (channel, id) iterates chronologically
schema.register({
  name: 'message',
  fields: [
    { name: 'channel', type: 'string', required: true },
    { name: 'id', type: 'string', required: true },
    { name: 'author', type: 'buffer', required: true }, // identity key
    { name: 'text', type: 'string', required: true },
    { name: 'ts', type: 'uint', required: true },
    { name: 'files', type: '@p2pcord/file', array: true },
    { name: 'replyTo', type: 'string' },
    { name: 'edited', type: 'uint' }
  ]
})

schema.register({
  name: 'message-edit',
  fields: [
    { name: 'channel', type: 'string', required: true },
    { name: 'id', type: 'string', required: true },
    { name: 'text', type: 'string', required: true },
    { name: 'ts', type: 'uint', required: true }
  ]
})

schema.register({
  name: 'message-ref',
  fields: [
    { name: 'channel', type: 'string', required: true },
    { name: 'id', type: 'string', required: true }
  ]
})

// Key rotation: the old base points to its successor and holds, per remaining
// member, an invite to the successor sealed to that member's identity key.
schema.register({
  name: 'successor',
  fields: [
    { name: 'id', type: 'string', required: true },
    { name: 'ref', type: 'buffer', required: true } // hash of the successor base key
  ]
})

schema.register({
  name: 'rekey',
  fields: [
    { name: 'to', type: 'buffer', required: true }, // identity key
    { name: 'ref', type: 'buffer', required: true },
    { name: 'box', type: 'buffer', required: true } // crypto_box_seal(invite)
  ]
})

// In the successor base: who may move over, with which role
schema.register({
  name: 'migrant',
  fields: [
    { name: 'identity', type: 'buffer', required: true },
    { name: 'role', type: 'uint', required: true },
    { name: 'name', type: 'string', required: true }
  ]
})

Hyperschema.toDisk(hyperSchema)

const hyperdb = HyperdbBuilder.from(SCHEMA_DIR, DB_DIR)
const db = hyperdb.namespace('p2pcord')
db.collections.register({ name: 'info', schema: '@p2pcord/info', key: ['id'] })
db.collections.register({ name: 'members', schema: '@p2pcord/member', key: ['writer'] })
db.collections.register({ name: 'channels', schema: '@p2pcord/channel', key: ['id'] })
db.collections.register({ name: 'invites', schema: '@p2pcord/invite', key: ['id'] })
db.collections.register({ name: 'messages', schema: '@p2pcord/message', key: ['channel', 'id'] })
db.collections.register({ name: 'successor', schema: '@p2pcord/successor', key: ['id'] })
db.collections.register({ name: 'rekeys', schema: '@p2pcord/rekey', key: ['to'] })
db.collections.register({ name: 'migrants', schema: '@p2pcord/migrant', key: ['identity'] })
HyperdbBuilder.toDisk(hyperdb)

const hyperdispatch = Hyperdispatch.from(SCHEMA_DIR, DISPATCH_DIR, { offset: 0 })
const dispatch = hyperdispatch.namespace('p2pcord')
// Never reorder or remove entries: the index is the on-disk op code.
dispatch.register({ name: 'set-info', requestType: '@p2pcord/info' })
dispatch.register({ name: 'add-member', requestType: '@p2pcord/member' })
dispatch.register({ name: 'remove-member', requestType: '@p2pcord/member-ref' })
dispatch.register({ name: 'set-role', requestType: '@p2pcord/member-role' })
dispatch.register({ name: 'set-name', requestType: '@p2pcord/member-name' })
dispatch.register({ name: 'add-channel', requestType: '@p2pcord/channel' })
dispatch.register({ name: 'remove-channel', requestType: '@p2pcord/channel-ref' })
dispatch.register({ name: 'add-invite', requestType: '@p2pcord/invite' })
dispatch.register({ name: 'use-invite', requestType: '@p2pcord/invite-ref' })
dispatch.register({ name: 'remove-invite', requestType: '@p2pcord/invite-ref' })
dispatch.register({ name: 'add-message', requestType: '@p2pcord/message' })
dispatch.register({ name: 'edit-message', requestType: '@p2pcord/message-edit' })
dispatch.register({ name: 'remove-message', requestType: '@p2pcord/message-ref' })
dispatch.register({ name: 'set-successor', requestType: '@p2pcord/successor' })
dispatch.register({ name: 'add-rekey', requestType: '@p2pcord/rekey' })
dispatch.register({ name: 'add-migrant', requestType: '@p2pcord/migrant' })
Hyperdispatch.toDisk(hyperdispatch)
