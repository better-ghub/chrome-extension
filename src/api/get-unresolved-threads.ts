// GraphQL - Get unresolved review threads for PR(s)

import { graphqlCall, getToken } from './client';
import type { UnresolvedThreadsResult, GraphQLResponse, PRBatchItem } from '../types';

// Helper to check if token is set
function hasToken(): boolean {
  return getToken() !== null;
}

// Single PR
export async function getUnresolvedThreads(
  owner: string,
  repo: string,
  number: number
): Promise<UnresolvedThreadsResult> {
  const query = `
    query($owner: String!, $repo: String!, $number: Int!) {
      repository(owner: $owner, name: $repo) {
        pullRequest(number: $number) {
          reviewThreads(first: 100) {
            nodes {
              isResolved
              isOutdated
              comments(first: 1) {
                nodes { author { login } }
              }
            }
          }
        }
      }
    }
  `;

  const variables = { owner, repo, number };
  const data = await graphqlCall<GraphQLResponse>(query, variables);
  if (!data?.repository?.pullRequest?.reviewThreads) {
    return { count: 0, byAuthor: {} };
  }

  const threads = data.repository.pullRequest.reviewThreads.nodes;
  const unresolvedThreads = threads.filter((t) => !t.isResolved && !t.isOutdated);

  const byAuthor: Record<string, number> = {};
  unresolvedThreads.forEach((thread) => {
    const author = thread.comments?.nodes?.[0]?.author?.login || 'unknown';
    byAuthor[author] = (byAuthor[author] || 0) + 1;
  });

  return { count: unresolvedThreads.length, byAuthor };
}

// Batch multiple PRs
export async function getUnresolvedThreadsBatch(
  prList: PRBatchItem[]
): Promise<Record<string, UnresolvedThreadsResult>> {
  if (!hasToken() || prList.length === 0) return {};

  console.log(`Better GHub: Batch fetching ${prList.length} PRs`);

  const varDefs = prList
    .map((_, i) => `$owner${i}: String!, $repo${i}: String!, $number${i}: Int!`)
    .join(', ');

  const queryParts = prList.map(
    (_, i) => `
    pr${i}: repository(owner: $owner${i}, name: $repo${i}) {
      pullRequest(number: $number${i}) {
        reviewThreads(first: 100) {
          nodes {
            isResolved
            isOutdated
            comments(first: 1) {
              nodes { author { login } }
            }
          }
        }
      }
    }
  `
  );

  const variables: Record<string, string | number> = {};
  prList.forEach((pr, i) => {
    variables[`owner${i}`] = pr.owner;
    variables[`repo${i}`] = pr.repo;
    variables[`number${i}`] = pr.number;
  });

  const data = await graphqlCall<GraphQLResponse>(
    `query(${varDefs}) { ${queryParts.join('\n')} }`,
    variables
  );
  if (!data) return {};

  const results: Record<string, UnresolvedThreadsResult> = {};

  prList.forEach((pr, index) => {
    const key = `${pr.owner}/${pr.repo}/${pr.number}`;
    const prData = data[`pr${index}`];

    if (prData?.pullRequest?.reviewThreads) {
      const threads = prData.pullRequest.reviewThreads.nodes;
      const unresolvedThreads = threads.filter((t) => !t.isResolved && !t.isOutdated);

      const byAuthor: Record<string, number> = {};
      unresolvedThreads.forEach((thread) => {
        const author = thread.comments?.nodes?.[0]?.author?.login || 'unknown';
        byAuthor[author] = (byAuthor[author] || 0) + 1;
      });

      results[key] = { count: unresolvedThreads.length, byAuthor };
    } else {
      results[key] = { count: 0, byAuthor: {} };
    }
  });

  return results;
}
