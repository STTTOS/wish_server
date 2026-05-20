import test from 'node:test'
import assert from 'node:assert/strict'

import {
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
})
