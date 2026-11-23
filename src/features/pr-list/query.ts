// Better GHub - Batched GraphQL query for PR list rows (pure, unit-tested).
//
// One aliased query per chunk of <=10 rows replaces ~4 REST calls per row
// (~100 calls per page, which tripped GitHub's secondary rate limit).

export interface PRRef {
  owner: string;
  repo: string;
  number: number;
  /** "owner/repo#123" — also the data-bghub-pr attribute value. */
  key: string;
}

export const CHUNK_SIZE = 10;

export function prKey(owner: string, repo: string, number: number): string {
  return `${owner}/${repo}#${number}`;
}

const FIELDS = `
  number url additions deletions changedFiles mergeable reviewDecision isDraft createdAt updatedAt
  author { login }
  commits(last: 1) { nodes { commit { committedDate messageHeadline statusCheckRollup { state } author { name user { login } } } } }
  reviewRequests(first: 10) {
    nodes { requestedReviewer { __typename ... on User { login avatarUrl } ... on Team { name slug } } }
  }
  timelineItems(last: 5, itemTypes: [REVIEW_REQUESTED_EVENT]) {
    nodes { ... on ReviewRequestedEvent { createdAt requestedReviewer { __typename ... on User { login } } } }
  }
  comments(last: 1) { nodes { author { login } createdAt } }
  reviews(last: 1, states: [APPROVED, CHANGES_REQUESTED, COMMENTED, DISMISSED]) { nodes { author { login } submittedAt state } }
  reviewThreads(first: 100) { nodes { isResolved isOutdated comments(first: 1) { nodes { author { login } } } } }`;

const FILES = `
  files(first: 100) { nodes { path } }`;

export interface BuiltQuery {
  query: string;
  variables: Record<string, string | number>;
  /** aliases[i] is the response key for refs[i]. */
  aliases: string[];
}

export function buildPRQuery(refs: PRRef[], opts: { withFiles: boolean }): BuiltQuery {
  const params: string[] = [];
  const selections: string[] = [];
  const variables: Record<string, string | number> = {};
  const aliases: string[] = [];
  refs.forEach((ref, i) => {
    params.push(`$o${i}: String!`, `$r${i}: String!`, `$n${i}: Int!`);
    variables[`o${i}`] = ref.owner;
    variables[`r${i}`] = ref.repo;
    variables[`n${i}`] = ref.number;
    aliases.push(`pr${i}`);
    selections.push(`  pr${i}: repository(owner: $o${i}, name: $r${i}) { pullRequest(number: $n${i}) { ...BghubRow } }`);
  });
  const query = `query BghubPRList(${params.join(', ')}) {
${selections.join('\n')}
}
fragment BghubRow on PullRequest {${FIELDS}${opts.withFiles ? FILES : ''}
}`;
  return { query, variables, aliases };
}

export function chunk<T>(items: T[], size = CHUNK_SIZE): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
