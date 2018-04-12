import constants from './constants'
import { pairs } from './combinatorics'
import { permutation, combination } from 'js-combinatorics'
import munkres from 'munkres-js'
import bigInt from 'big-integer'
import _ from 'lodash'

export const matchLanes = ({ pairing, lanes }) => {
  if (pairing.length === 0) { return [[]] }

  const keys = Object.keys(lanes)

  if (keys.length === 0) { return [[]] }

  const product = permutation(pairing, keys.length).map((pairing) => pairing.map((pair, i) => [pair, keys[i]])).filter(pairing =>
    pairing.every(([pair, key]) =>
      lanes[key].length === 0 ||
          lanes[key].some(p => pair.includes(p))
    )
  )

  if (product.length === 0) {
    return false
  }

  return product
}

export const getMoves = ({ match, lanes }) => {
  if (match === undefined) {
    return []
  }
  const moves = match.map(([pair, key]) => {
    return {
      lane: key,
      entities: pair.filter(p => {
        return key === 'new-lane' ||
        lanes[key].length === 0 ||
        !lanes[key].includes(p)
      }),
    }
  }).filter(p => p.entities.length)
  return moves
}

export const scoreMatrix = (left, right, history, maxScore) => {
  const scores = {}

  left.forEach(l => {
    scores[l] = {}
    right.forEach(r => {
      scores[l][r] = bigInt(maxScore)
    })
  })

  history.forEach(h => {
    h.lanes.forEach(lane => {
      lane.left.forEach(l => {
        lane.right.forEach(r => {
          if (scores[l] && scores[l][r] !== undefined) {
            scores[l][r] = l !== r ? h.score : bigInt(-1)
          }
        })
      })
    })
  })

  return left.map((l, i) => right.map((r, j) => {
    return scores[l][r]
  }))
}

const applyAffinities = ({ peopleKeys, people, rawScores }) => {
  let scores = _.clone(rawScores)
  for (let person of people) {
    if (person.affinities !== undefined) {
      if (person.affinities.none !== undefined) {
        const peopleToAvoid = people.filter(p =>
          _.some(person.affinities.none,
            affinity => p.tags !== undefined && p.tags.includes(affinity))
        )
        peopleToAvoid.forEach(personToAvoid => {
          const leftIndex = peopleKeys.indexOf(key(person))
          const rightIndex = peopleKeys.indexOf(key(personToAvoid))
          scores[leftIndex][rightIndex] = bigInt(0)
          scores[rightIndex][leftIndex] = bigInt(0)
        })
      }
    }
  }
  return rawScores
}

export const mergePairsScores = (scores, pairs) => {
  const merged = []
  pairs.forEach(pair => {
    merged.push(scores[pair[0]].map((score, i) => {
      let other = score
      if (pair[1]) { other = scores[pair[1]][i] }
      return score + other
    }))
  })
  return merged
}

const key = e => e['.key']

export const allPossibleAssignments = function * ({ current }) {
  const laneKeys = current.lanes.filter(l => !l.locked).map(key)
  const people = _.shuffle(current.entities.filter(e =>
    e.type === 'person' &&
    (e.location === constants.LOCATION.UNASSIGNED || laneKeys.includes(e.location))
  ))
  const assignments = _.map(_.mapValues(_.groupBy(people, 'location'), v => v.map(key)), (l, p) => [p, l])
  let unassigned = _.remove(assignments, as => as[0] === 'unassigned')[0]
  if (unassigned === undefined) {
    unassigned = []
  } else {
    unassigned = unassigned[1]
  }
  if (people.length % 2 === 1) {
    unassigned.push('<solo>')
  }
  const totalLanes = people.length % 2 === 1 ? (people.length + 1) / 2 : people.length / 2

  const emptyLanes = _.difference(laneKeys, people.map(p => p.location))

  const generateUniqPairings = function * ({ unassigned, remainingLaneCount }) {
    const unassignedPeople = combination(unassigned, remainingLaneCount * 2)
    let unassignedGroup = unassignedPeople.next()
    while (unassignedGroup !== undefined) {
      const combinationsOfPeople = combination(unassignedGroup, 2).map(c => c)
      const combinationTracker = combinationsOfPeople.reduce((combos, pair) => {
        if (combos[pair[0]] === undefined) {
          combos[pair[0]] = {}
        }
        combos[pair[0]][pair[1]] = false
        return combos
      }, {})
      for (const c of combinationsOfPeople) {
        if (combinationTracker[c[0]][c[1]] === true) {
          return
        }

        const thisSet = []
        thisSet.push(c)
        combinationTracker[c[0]][c[1]] = true
        while (thisSet.length < remainingLaneCount) {
          const idx = combinationsOfPeople.findIndex(c => c.every(p => thisSet.every(pair => !pair.includes(p))))
          const next = combinationsOfPeople[idx]
          thisSet.push(next)
          combinationTracker[next[0]][next[1]] = true
        }

        yield thisSet
      }
      unassignedGroup = unassignedPeople.next()
    }
  }

  const generateLaneSynthesizers = function * ({ currentLaneChoices, currentAssignment, remainingAssignments, wrapUp, unassigned, remainingLaneCount }) {
    const processSetting = function * ([person, newUnassigned, i]) {
      const wrapUpThisLevel = function * ({ tailAssignments }) {
        while (tailAssignments.length > 0) {
          const assignment = tailAssignments.pop()
          for (let j = 0; j < assignment.unassigned.length; j++) {
            const unassignedPerson = assignment.unassigned[j]
            if (i > 0 && currentAssignment[1].includes(unassignedPerson)) {
              return
            }

            yield * wrapUp({
              tailAssignments: [{
                results: assignment.results.concat([[[person, unassignedPerson], currentAssignment[0]]]),
                unassigned: _.difference(assignment.unassigned, [unassignedPerson]),
              }],
            })
          }
        }
      }

      yield {
        remainingAssignments: _.tail(remainingAssignments),
        unassigned: _.concat(unassigned, newUnassigned),
        remainingLaneCount: remainingLaneCount - 1,
        wrapUp: wrapUpThisLevel,
      }
    }

    while (currentLaneChoices.length > 0) {
      yield * processSetting(currentLaneChoices.shift())
    }
  }

  const wrapperUpper = function * (nextGenerator) {
    const wrapItem = function * ({ remainingAssignments, unassigned, wrapUp, remainingLaneCount }) {
      if (remainingAssignments.length === 0) {
        if (remainingLaneCount === 0) {
          yield * wrapUp({ tailAssignments: [{ results: [], unassigned: unassigned }] })
        } else {
          const uniqNewPairings = generateUniqPairings({ unassigned, remainingLaneCount })
          let nextPairing = uniqNewPairings.next()
          while (!nextPairing.done) {
            const pairing = nextPairing.value
            let lanePermutations = [emptyLanes]
            if (emptyLanes.length > 0) {
              lanePermutations = permutation(emptyLanes).toArray()
            }
            for (let lanes of lanePermutations) {
              while (lanes.length < pairing.length) {
                lanes.push('new-lane')
              }
              yield * wrapUp({
                tailAssignments: [{
                  results: lanes.map((l, i) => [pairing[i], l]),
                  unassigned: _.difference(unassigned, _.flatten(pairing)),
                }],
              })
            }
            nextPairing = uniqNewPairings.next()
          }
        }
      }
    }

    for (let nextItem of nextGenerator) {
      yield * wrapItem(nextItem)
    }
  }

  const generateSubAssignments = function * ({ remainingAssignments, unassigned, wrapUp, remainingLaneCount }) {
    if (remainingAssignments.length > 0) {
      const currentAssignment = _.head(remainingAssignments)
      const currentLaneChoices = currentAssignment[1].map((person, i) => [person, _.difference(currentAssignment[1], [person]), i])

      for (let synthesizer of generateLaneSynthesizers({ currentLaneChoices, currentAssignment, remainingAssignments, wrapUp, unassigned, remainingLaneCount })) {
        yield synthesizer
        if (synthesizer.remainingAssignments.length > 0) {
          yield * generateSubAssignments(synthesizer)
        }
      }
    }
  }

  const innerFindAssignments = function * ({ initialAssignments, wrapUp, unassigned, remainingLaneCount }) {
    const firstItem = {
      remainingAssignments: initialAssignments,
      unassigned: unassigned,
      wrapUp,
      remainingLaneCount: remainingLaneCount,
    }

    let settingGenerator = generateSubAssignments(firstItem)
    let next = settingGenerator.next()
    do {
      let nextItem = next.value
      yield * wrapperUpper(nextItem === undefined ? [firstItem] : [nextItem])
      next = settingGenerator.next()
    } while (!next.done)
  }

  yield * innerFindAssignments({
    initialAssignments: assignments,
    unassigned,
    remainingLaneCount: totalLanes,
    wrapUp: function * ({ tailAssignments }) {
      while (tailAssignments.length > 0) {
        const nextAssignment = tailAssignments.pop()
        yield nextAssignment.results.map(as => [_.without(as[0], '<solo>'), as[1]])
      }
    },
  })
}

export const calculateMovesToBestPairing = ({ current, history }) => {
  const laneKeys = current.lanes.filter(l => !l.locked).map(key)
  let optimizedHistory = []
  const people = current.entities.filter(e =>
    e.type === 'person' &&
    (e.location === constants.LOCATION.UNASSIGNED || laneKeys.includes(e.location))
  )

  if ((2 * laneKeys.length - 1) > people.length) { return null }

  const peopleKeys = people.map(key)
  if (peopleKeys.length % 2 === 1) { peopleKeys.push('<solo>') }
  const lanes = Object.assign(
    ...laneKeys.map(key => ({ [key]: [] })),
    _.mapValues(_.groupBy(
      people.filter(e => laneKeys.includes(e.location)),
      'location',
    ), v => v.map(key)),
  )
  const tracks = current.entities.filter(e =>
    e.type === 'track' &&
      (e.location === constants.LOCATION.UNASSIGNED || laneKeys.includes(e.location))
  )
  const lanesToTracks = getTracksToLanes({ tracks })

  if (peopleKeys.length === 0) { return [] }

  let maxScore = 0

  if (history && history.length > 0) {
    maxScore = bigInt(parseInt(_.last(history)['.key']))

    optimizedHistory = history.map(h => {
      const groups = _.groupBy(h.entities.filter(e =>
        e.type === 'person' &&
        e.location !== constants.LOCATION.UNASSIGNED &&
        e.location !== constants.LOCATION.OUT
      ), 'location')
      const lanes = []
      const score = bigInt(maxScore - parseInt(h['.key']))

      Object.values(groups).forEach(people => {
        people = people.map(key)
        if (people.length === 1) { people.push('<solo>') }

        lanes.push({
          left: people,
          right: people,
        })
      })
      return { score, lanes }
    })
  } else {
    optimizedHistory = []
  }

  const rawScores = scoreMatrix(peopleKeys, peopleKeys, optimizedHistory, maxScore + 1)
  const scores = applyAffinities({ peopleKeys, people, rawScores })

  // set pairing solos to lowest possible score
  const solos = _.flatten(Object.values(lanes).filter(l => l.length === 1))
    .map(p => peopleKeys.indexOf(p))
  pairs(solos).forEach(p => {
    scores[p[0]][p[1]] = bigInt(-1)
    scores[p[1]][p[0]] = bigInt(-1)
  })
  const trackScoreLedger = calculateTrackScores({ current, history })
  const pairKeyIndices = peopleKeys.map((key, i) => [key, i])
    .reduce((keysIndices, [key, i]) => {
      keysIndices[key] = i
      return keysIndices
    }, {})

  const assts = allPossibleAssignments({ current })
  let nextAssignment = assts.next()
  if (nextAssignment.done) {
    return []
  }
  let bestPairing = nextAssignment.value

  let highestScore = bestPairing.reduce((sum, a) => {
    const pair = a[0]
    const lane = a[1]
    return sum.add(scoreAssignment({ pair, lane, lanesToTracks, trackScoreLedger, pairKeyIndices, scores }))
  }, bigInt(0))

  let assignment = bestPairing
  while (!nextAssignment.done) {
    assignment = nextAssignment.value

    const pairScore = assignment.reduce((sum, a) => {
      const pair = a[0]
      const lane = a[1]
      return sum.add(scoreAssignment({ pair, lane, lanesToTracks, trackScoreLedger, pairKeyIndices, scores }))
    }, bigInt(0))

    if (pairScore > highestScore) {
      bestPairing = assignment
      highestScore = pairScore
    }
    nextAssignment = assts.next()
  }

  return getMoves({ match: bestPairing, lanes })
}

const scoreAssignment = ({ pair, lane, lanesToTracks, trackScoreLedger, pairKeyIndices, scores }) => {
  const firstPerson = pairKeyIndices[pair[0]]
  let secondPerson = firstPerson
  if (pair[1] !== undefined) {
    secondPerson = pairKeyIndices[pair[1]]
  }
  let trackScore = bigInt(1)
  const pairScore = scores[firstPerson][secondPerson]

  if (lanesToTracks[lane] !== undefined) {
    const self = pair[0]
    let other = self
    if (pair[1] !== undefined) {
      other = pair[1]
    }
    trackScore = lanesToTracks[lane].reduce((sum, t) => {
      return sum.add(trackScoreLedger[self][t]).add(trackScoreLedger[other][t])
    }, bigInt(1))
  }

  return trackScore.multiply(pairScore)
}

const getTracksToLanes = ({ tracks }) => {
  const tracksToLanes = tracks.reduce((acc, track) => {
    acc[key(track)] = track.location
    return acc
  }, {})
  return _.invertBy(tracksToLanes)
}

const calculateTrackScores = ({ current, history }) => {
  const laneKeys = current.lanes.filter(l => !l.locked).map(key)
  const people = current.entities.filter(e =>
    e.type === 'person' &&
    (e.location === constants.LOCATION.UNASSIGNED || laneKeys.includes(e.location))
  )
  const tracks = current.entities.filter(e =>
    e.type === 'track' &&
    (e.location === constants.LOCATION.UNASSIGNED || laneKeys.includes(e.location))
  )

  const scoreCalculator = {}
  const maxConsidered = 10
  let maxScore = bigInt(1)
  for (let i = 1; i <= maxConsidered; i++) {
    maxScore = maxScore.add(bigInt(2).pow(i))
  }
  people.forEach(l => {
    scoreCalculator[l['.key']] = {}
    tracks.forEach(r => {
      scoreCalculator[l['.key']][r['.key']] = maxScore
    })
  })

  if (history && history.length > 0) {
    _.take(history, maxConsidered).forEach((h, i) => {
      const groups = _.groupBy(
        h.entities.filter(e =>
          e.location !== constants.LOCATION.UNASSIGNED && e.location !== constants.LOCATION.OUT
        ),
        'location',
      )

      Object.values(groups).forEach(entities => {
        const lane = _.groupBy(entities, 'type')
        if (lane['person'] === undefined) {
          return
        }
        if (lane['track'] === undefined) {
          return
        }

        const personKeys = people.map(pers => pers['.key'])
        const trackKeys = tracks.map(track => track['.key'])
        const inPeople = lane['person'].filter(p => personKeys.includes(p['.key']))
        const inTracks = lane['track'].filter(t => trackKeys.includes(t['.key']))
        inPeople.forEach(p => {
          inTracks.forEach((t) => {
            scoreCalculator[p['.key']][t['.key']] = scoreCalculator[p['.key']][t['.key']].subtract(bigInt(2).pow(maxConsidered - i))
          })
        })
      })
    })
  }

  return scoreCalculator
}

export const calculateMovesToBestAssignment = ({ left, right, current, history }) => {
  const laneKeys = current.lanes.filter(l => !l.locked).map(key)
  const leftEntities = current.entities.filter(e =>
    e.type === left && laneKeys.includes(e.location)
  )
  const rightEntities = current.entities.filter(e =>
    e.type === right &&
    (e.location === constants.LOCATION.UNASSIGNED || laneKeys.includes(e.location))
  )

  const leftKeys = leftEntities.map(key)
  const rightKeys = rightEntities.map(key)

  if (leftKeys.length === 0) { return [] }

  let maxScore = 0

  if (history && history.length > 0) {
    maxScore = parseInt(_.last(history)['.key'])

    history = history.map(h => {
      const groups = _.groupBy(h.entities.filter(e =>
        e.location !== constants.LOCATION.UNASSIGNED &&
        e.location !== constants.LOCATION.OUT
      ), 'location')
      const lanes = []
      const score = maxScore - parseInt(h['.key'])

      Object.values(groups).forEach(entities => {
        entities = entities.map(key)

        lanes.push({
          left: entities.filter(e => e.type === left),
          right: entities.filter(e => e.type === right),
        })
      })
      return { score, lanes }
    })
  } else {
    history = []
  }

  const scores = scoreMatrix(leftKeys, rightKeys, history, maxScore + 1)
  let pairs = Object.values(_.groupBy(leftEntities.filter(e => e.location !== constants.LOCATION.OUT), 'location'))
    .map(p => p.map(e => leftKeys.indexOf(key(e))))
  let mergedScores = mergePairsScores(scores, pairs)

  while (pairs.length < rightKeys.length) {
    pairs = pairs.concat(pairs)
    mergedScores = mergedScores.concat(mergedScores)
  }

  const assignment = munkres(munkres.make_cost_matrix(mergedScores))
    .map(a => [pairs[a[0]], rightKeys[a[1]]])

  const results = []
  assignment.forEach(a => {
    const lane = leftEntities.find(e => e['.key'] === leftKeys[a[0][0]]).location
    if (rightEntities.find(e => e['.key'] === a[1]).location !== lane) {
      results.push({
        lane,
        entities: [a[1]],
      })
    }
  })
  return results
}
