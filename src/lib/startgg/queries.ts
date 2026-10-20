export const EVENT_PHASES = `
query EventPhases($slug: String!) {
  event(slug: $slug) {
    id
    name
    slug
    phases {
      id
      name
      bracketType
    }
  }
}
`

export const PHASE_SEEDS = `
query PhaseSeeds($phaseId: ID!, $page: Int!) {
  phase(id: $phaseId) {
    id
    name
    bracketType
    seeds(query: { page: $page, perPage: 32 }) {
      pageInfo { totalPages }
      nodes {
        id
        seedNum
        entrant {
          id
          participants {
            gamerTag
            player { id }
          }
        }
      }
    }
  }
}
`

export const PHASE_SETS = `
query PhaseSets($phaseId: ID!, $page: Int!) {
  phase(id: $phaseId) {
    id
    sets(page: $page, perPage: 32, sortType: STANDARD) {
      pageInfo { totalPages }
      nodes {
        id
        state
        round
        fullRoundText
        winnerId
        slots {
          slotIndex
          seed { id seedNum }
          prereqId
          prereqType
          prereqPlacement
          entrant {
            id
            participants {
              gamerTag
              player { id }
            }
          }
        }
        games { id }
      }
    }
  }
}
`

export const H2H_SETS = `
query HeadToHead($playerId: ID!, $opponentId: ID!, $page: Int!, $state: [Int]) {
  player(id: $playerId) {
    id
    sets(page: $page, perPage: 5, opponentId: $opponentId, filters: { state: $state }) {
      pageInfo { totalPages }
      nodes {
        id
        state
        completedAt
        startedAt
        fullRoundText
        winnerId
        event {
          name
          slug
          startAt
          tournament { slug }
        }
        slots {
          entrant {
            id
            participants {
              gamerTag
              player { id }
            }
          }
        }
      }
    }
  }
}
`

export const UPDATE_PHASE_SEEDING = `
mutation UpdatePhaseSeeding($phaseId: ID!, $seedMapping: [UpdatePhaseSeedInfo]!) {
  updatePhaseSeeding(phaseId: $phaseId, seedMapping: $seedMapping) {
    id
  }
}
`
