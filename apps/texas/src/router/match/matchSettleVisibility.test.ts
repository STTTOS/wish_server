import test from 'node:test'
import assert from 'node:assert/strict'

import {
  projectSettleRecordsForMatchDetail,
  projectTargetUserHistoryListFields,
  shouldHideTargetHandFromHistoryViewer,
  isNoShowdownSingleWinnerFromParticipants
} from './matchSettleVisibility'

test('isNoShowdownSingleWinnerFromParticipants: one non-folder', () => {
  assert.equal(
    isNoShowdownSingleWinnerFromParticipants([
      { isFold: true },
      { isFold: false }
    ]),
    true
  )
})

test('isNoShowdownSingleWinnerFromParticipants: showdown', () => {
  assert.equal(
    isNoShowdownSingleWinnerFromParticipants([
      { isFold: false },
      { isFold: false }
    ]),
    false
  )
})

test('shouldHideTargetHandFromHistoryViewer', () => {
  assert.equal(
    shouldHideTargetHandFromHistoryViewer({
      viewingSelf: true,
      targetIsFold: true,
      isNoShowdownSingleWinner: true
    }),
    false
  )
  assert.equal(
    shouldHideTargetHandFromHistoryViewer({
      viewingSelf: false,
      targetIsFold: true,
      isNoShowdownSingleWinner: false
    }),
    true
  )
  assert.equal(
    shouldHideTargetHandFromHistoryViewer({
      viewingSelf: false,
      targetIsFold: false,
      isNoShowdownSingleWinner: true
    }),
    true
  )
  assert.equal(
    shouldHideTargetHandFromHistoryViewer({
      viewingSelf: false,
      targetIsFold: false,
      isNoShowdownSingleWinner: false
    }),
    false
  )
  assert.equal(
    shouldHideTargetHandFromHistoryViewer({
      viewingSelf: false,
      targetIsFold: true,
      isNoShowdownSingleWinner: false,
      voluntarilyShownHand: true
    }),
    false
  )
})

test('projectTargetUserHistoryListFields masks hole cards for other viewers', () => {
  const hidden = projectTargetUserHistoryListFields({
    viewingSelf: false,
    isFold: true,
    isNoShowdownSingleWinner: false,
    handPokes: ['h2', 'h3'],
    rankCategory: 'pair'
  })
  assert.deepEqual(hidden.handPokes, [])
  assert.equal(hidden.rankCategory, null)
  assert.equal(hidden.voluntarilyShownHand, false)

  const loneWin = projectTargetUserHistoryListFields({
    viewingSelf: false,
    isFold: false,
    isNoShowdownSingleWinner: true,
    handPokes: ['s2', 's7'],
    rankCategory: 'high_card'
  })
  assert.deepEqual(loneWin.handPokes, [])
  assert.equal(loneWin.rankCategory, null)

  const shown = projectTargetUserHistoryListFields({
    viewingSelf: false,
    isFold: false,
    isNoShowdownSingleWinner: false,
    handPokes: ['h2', 'h3'],
    rankCategory: 'pair'
  })
  assert.deepEqual(shown.handPokes, ['h2', 'h3'])
  assert.equal(shown.rankCategory, 'pair')

  const voluntarily = projectTargetUserHistoryListFields({
    viewingSelf: false,
    isFold: true,
    isNoShowdownSingleWinner: false,
    voluntarilyShownHand: true,
    handPokes: ['dA', 'dK'],
    rankCategory: 'high_card'
  })
  assert.deepEqual(voluntarily.handPokes, ['dA', 'dK'])
  assert.equal(voluntarily.rankCategory, 'high_card')
  assert.equal(voluntarily.voluntarilyShownHand, true)
})

test('projectSettleRecordsForMatchDetail reveals voluntarily shown fold / lone win', () => {
  const user = {
    id: 2,
    name: 'B',
    avatarUrl: null as string | null,
    avatarKey: 'a'
  }
  const base = {
    id: 1,
    role: null,
    wager: 0,
    isAllIn: false,
    rankStrength: 1,
    rankSignature: null as string | null
  }
  const records = [
    {
      ...base,
      id: 10,
      userId: 1,
      isFold: false,
      wager: 100,
      handPokes: ['s2', 's3'],
      rankCategory: 'high_card',
      voluntaryShowHandAt: null,
      user: { id: 1, name: 'A', avatarUrl: null, avatarKey: 'a' }
    },
    {
      ...base,
      id: 11,
      userId: 2,
      isFold: true,
      wager: -50,
      handPokes: ['hA', 'hK'],
      rankCategory: 'high_card',
      voluntaryShowHandAt: new Date('2026-01-01T00:00:00Z'),
      user
    }
  ]

  const projected = projectSettleRecordsForMatchDetail(records, {
    viewerUserId: 1,
    matchEnded: true
  })
  const foldedShown = projected.find((r) => r.userId === 2)
  assert.ok(foldedShown)
  assert.equal(foldedShown.voluntarilyShownHand, true)
  assert.deepEqual(foldedShown.handPokes, ['hA', 'hK'])
  assert.equal(foldedShown.rankCategory, 'high_card')

  const hiddenFold = projectSettleRecordsForMatchDetail(
    records.map((r) =>
      r.userId === 2 ? { ...r, voluntaryShowHandAt: null } : r
    ),
    { viewerUserId: 1, matchEnded: true }
  ).find((r) => r.userId === 2)
  assert.ok(hiddenFold)
  assert.equal(hiddenFold.voluntarilyShownHand, false)
  assert.deepEqual(hiddenFold.handPokes, [])
  assert.equal(hiddenFold.rankCategory, null)
})
