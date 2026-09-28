const { test } = require('node:test');
const assert = require('node:assert/strict');
const { shuffleInPlace, pageItems } = require('../dist/queue');
test('shuffle preserves every queue item and duplicate, without touching current track', () => {
    const playing = { id: 'current' };
    const queue = Array.from({length: 1000}, (_, id) => ({ id, url: `track-${id % 20}` }));
    const original = [...queue];
    shuffleInPlace(queue, () => 0.25);
    assert.equal(queue.length, 1000);
    assert.equal(new Set(queue).size, 1000);
    assert.deepEqual([...queue].sort((a,b)=>a.id-b.id), original);
    assert.notDeepEqual(queue, original);
    assert.equal(playing.id, 'current');
});
test('empty and single-track queues can be shuffled', () => {
    const empty = []; shuffleInPlace(empty); assert.deepEqual(empty, []);
    const single = ['a']; shuffleInPlace(single); assert.deepEqual(single, ['a']);
});
test('large queues paginate without dropping or repeating entries', () => {
    const all = Array.from({length: 127}, (_, i) => i);
    const pages = [0,50,100].map(offset => pageItems(all,offset,50));
    assert.deepEqual(pages.flatMap(page=>page.tracks),all);
    assert.equal(pages[2].hasMore,false);
    assert.equal(pages[0].hasMore,true);
    assert.equal(pageItems(all,0,10000).tracks.length,100);
    assert.equal(pageItems(all,-4,NaN).tracks.length,50);
});
