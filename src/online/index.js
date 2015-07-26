
import Bacon      from 'baconjs'
import { Parse }  from 'parse'
import invariant  from 'invariant'

// https://github.com/baconjs/bacon.js/issues/536
function makeEager(川) {
  return 川.subscribe(() => {})
}

export function Online() {

  const user口 = new Bacon.Bus()
  const user川 = user口.toProperty(Parse.User.current()).map(unwrapUser)

  // user川 needs to be eager, so that when someone subscribes, they always
  // get the latest user value.
  makeEager(user川)

  function wrapPromise(promise) {
    return Promise.resolve(promise).catch(function(error) {
      if (error instanceof Error) {
        throw error
      } else {
        throw new Error('Parse Error ' + error.code + ': ' + error.message)
      }
    })
  }

  function unwrapUser(parseUser) {
    if (!parseUser) return null
    return {
      username: parseUser.get('username'),
      email:    parseUser.get('email'),
    }
  }

  function toObject(物) {
    return Object.assign({ }, 物.attributes, { id: 物.id })
  }

  function signUp({ username, password, email }) {
    invariant(typeof username === 'string', 'username must be a string')
    invariant(typeof password === 'string', 'password must be a string')
    invariant(typeof email === 'string',    'email must be a string')
    return (
      wrapPromise(Parse.User.signUp(username, password, { email }))
      .tap(user => user口.push(user))
    )
  }

  function logIn({ username, password }) {
    invariant(typeof username === 'string', 'username must be a string')
    invariant(typeof password === 'string', 'password must be a string')
    return (
      wrapPromise(Parse.User.logIn(username, password))
      .tap(user => user口.push(user))
    )
  }

  function logOut() {
    return (
      wrapPromise(Parse.User.logOut()).then(() => {})
      .tap(() => user口.push(null))
    )
  }

  function submitScore(info) {
    return (
      wrapPromise(Parse.Cloud.run('submitScore', info))
      .then(({ data, meta }) => {
        return {
          data: toObject(data),
          meta: meta
        }
      })
    )
  }

  function retrieveRecord({ md5, playMode }) {
    invariant(typeof md5      === 'string', 'md5 must be a string')
    invariant(typeof playMode === 'string', 'playMode must be a string')
    var query = new Parse.Query('GameScore')
    query.equalTo('md5',      md5)
    query.equalTo('playMode', playMode)
    query.equalTo('user',     Parse.User.current())
    return (
      wrapPromise(query.first())
      .then(gameScore => {
        if (gameScore) {
          var countQuery = new Parse.Query('GameScore')
          countQuery.equalTo('md5',       md5)
          countQuery.equalTo('playMode',  playMode)
          countQuery.greaterThan('score', gameScore.get('score'))
          return (
            wrapPromise(countQuery.count())
            .then(x => x + 1, () => null)
            .then(rank => ({ data: toObject(gameScore), meta: { rank } }))
          )
        } else {
          return {
            data: null,
            meta: { rank: null }
          }
        }
      })
    )
  }

  function reloadable川(promiseFactory, execute川) {
    let state川 = (
      execute川
      .flatMapLatest(() => {
        return (
          Bacon.fromPromise(Promise.resolve(promiseFactory()))
          .map(    value  => prev => _.assign({ }, prev, { status: 'completed', value, error: null }))
          .mapError(error => prev => _.assign({ }, prev, { status: 'error', error }))
          .startWith(        prev => _.assign({ }, prev, { status: 'loading', error: null }))
        )
      })
      .scan(
        { status: 'loading', value: null, error: null },
        (prev, next) => next(prev)
      )
    )
    return state川
  }

  function getScoreboard({ md5, playMode }) {
    invariant(typeof md5      === 'string', 'md5 must be a string')
    invariant(typeof playMode === 'string', 'playMode must be a string')
    var query = new Parse.Query('GameScore')
    query.equalTo('md5', md5)
    query.equalTo('playMode', playMode)
    query.descending('score')
    query.limit(100)
    return (
      wrapPromise(query.find())
      .then(results => {
        return {
          data: results.map(toObject)
        }
      })
    )
  }

  function submitOrRetrieveRecord(data) {
    if (Parse.User.current()) {
      if (data.score) {
        return submitScore(data)
      } else {
        return retrieveRecord(data)
      }
    } else {
      let error = new Error('Unauthenticated!')
      error.isUnauthenticated = true
      return Promise.reject(error)
    }
  }

  function Ranking(data) {

    const resubmit口   = new Bacon.Bus()
    const reload口     = new Bacon.Bus()

    const submission川 = (
      reloadable川(
        () => submitOrRetrieveRecord(data),
        (
          Bacon.once()
          .merge(resubmit口)
          .merge(user川.changes().filter(user => !!user).first())
        )
      )
      .map(state => {
        if (state.status === 'completed') {
          return {
            status: 'completed',
            error:  null,
            record: state.value.data,
            rank:   state.value.meta.rank,
          }
        } else if (state.status === 'error' && state.error.isUnauthenticated) {
          return {
            status: 'unauthenticated',
            error:  null,
            record: null,
            rank:   null,
          }
        } else {
          return {
            status: state.status,
            error:  state.error,
            record: null,
            rank:   null,
          }
        }
      })
    )

    const scoreboard川 = reloadable川(
      () => getScoreboard(data),
      submission川.filter(({ status }) => status === 'unauthenticated' || status === 'completed')
    )

    const state川 = Bacon.combineWith(
      function(submission, scoreboard) {
        return {
          data: scoreboard.value && scoreboard.value.data,
          meta: {
            scoreboard: {
              status: scoreboard.status,
              error:  scoreboard.error
            },
            submission: submission,
          },
        }
      },
      submission川,
      scoreboard川
    )

    return {
      state川,
      resubmit() {
        resubmit口.push()
      },
      reloadScoreboard() {
        reload口.push()
      },
    }
  }

  return {
    user川,
    signUp,
    logIn,
    logOut,
    submitScore,
    scoreboard: getScoreboard,
    Ranking,
  }
}

export default Online