// GraphQL - Get unresolved review threads for PR(s)

import { graphqlCall, getToken } from './client';
import type { UnresolvedThreadsResult, GraphQLResponse, PRBatchItem } from '../types';

// Single PR
export async function getUnresolvedThreads(
  owner: string,
  repo: string,
  number: number
): Promise<UnresolvedThreadsResult> {
  const query = `
    query {
      repository(owner: "${owner}", name: "${repo}") {
        pullRequest(number: ${number}) {
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

  const data = await graphqlCall<GraphQLResponse>(query);
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
  const { token } = getToken();
  if (!token || prList.length === 0) return {};

  console.log(`Better GHub: Batch fetching ${prList.length} PRs`);

  const queryParts = prList.map(
    (pr, i) => `
    pr${i}: repository(owner: "${pr.owner}", name: "${pr.repo}") {
      pullRequest(number: ${pr.number}) {
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

  const data = await graphqlCall<GraphQLResponse>(`query { ${queryParts.join('\n')} }`);
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
