import assert from 'node:assert/strict'
import test from 'node:test'

import {
  addEdge,
  addNode,
  emptyCanvas,
  findNode,
  removeNode,
  updateNode,
} from '../src/model.ts'

test('emptyCanvas starts with no nodes and no edges', () => {
  const c = emptyCanvas()
  assert.equal(c.nodes.length, 0)
  assert.equal(c.edges.length, 0)
})

test('addNode mints a stable id and appends', () => {
  const { state, node } = addNode(emptyCanvas(), { kind: 'text', label: 'a', x: 0, y: 0 })
  assert.equal(state.nodes.length, 1)
  assert.equal(node.id.length, 36) // uuid
  assert.equal(findNode(state, node.id)?.label, 'a')
})

test('addNode de-dupes a caller-supplied colliding id', () => {
  const { state } = addNode(emptyCanvas(), { kind: 'text', label: 'a', x: 0, y: 0, id: 'fixed' })
  const { node } = addNode(state, { kind: 'text', label: 'b', x: 1, y: 1, id: 'fixed' })
  assert.notEqual(node.id, 'fixed')
  assert.equal(node.id.length, 36)
})

test('removeNode also drops every edge touching it', () => {
  let c = emptyCanvas()
  let r = addNode(c, { kind: 'text', label: 'a', x: 0, y: 0 })
  const a = r.node
  c = r.state
  r = addNode(c, { kind: 'text', label: 'b', x: 1, y: 0 })
  const b = r.node
  c = r.state
  r = addNode(c, { kind: 'text', label: 'c', x: 2, y: 0 })
  const cNode = r.node
  c = r.state
  c = addEdge(c, { source: a.id, target: b.id }).state
  c = addEdge(c, { source: b.id, target: cNode.id }).state
  assert.equal(c.edges.length, 2)
  const after = removeNode(c, a.id)
  assert.equal(after.nodes.length, 2)
  assert.equal(after.edges.length, 1) // only the b->c edge survives
  assert.equal(after.edges[0]?.source, b.id)
})

test('removeNode is idempotent on a missing id', () => {
  const c = emptyCanvas()
  assert.equal(removeNode(c, 'nope'), c)
})

test('addEdge rejects a dangling endpoint', () => {
  const c = emptyCanvas()
  assert.throws(
    () => addEdge(c, { source: 'a', target: 'b' }),
    /需要两个已存在的节点/,
  )
})

test('updateNode patches mutable fields and leaves others intact', () => {
  let c = emptyCanvas()
  let r = addNode(c, { kind: 'image', label: 'a', x: 0, y: 0, meta: { width: 1024 } })
  const a = r.node
  c = r.state
  r = addNode(c, { kind: 'text', label: 'b', x: 1, y: 1 })
  const b = r.node
  c = r.state
  const after = updateNode(c, a.id, { label: 'a2', x: 99 })
  const patched = findNode(after, a.id)
  assert.equal(patched?.label, 'a2')
  assert.equal(patched?.x, 99)
  assert.deepEqual(patched?.meta, { width: 1024 })
  assert.equal(findNode(after, b.id)?.label, 'b')
})
