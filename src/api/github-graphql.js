// GitHub GraphQL API Client
// Handles GraphQL queries with batch support for unresolved threads

class BetterGHub_GitHubGraphQLAPI {
  constructor(token = null, tokenType = 'pat') {
    this.token = token;
    this.tokenType = tokenType;
    this.endpoint = 'https://api.github.com/graphql';
  }

  setToken(token, tokenType = 'pat') {
    this.token = token;
    this.tokenType = tokenType;
  }

  async query(graphqlQuery) {
    if (!this.token) {
      console.warn(`Better GHub v${BetterGHub_Constants.VERSION}: No token for GraphQL`);
      return null;
    }

    try {
      // Track API call with metrics
      BetterGHub_ApiMetrics.incrementCall('graphql', 'query');

      console.log(`Better GHub v${BetterGHub_Constants.VERSION}: GraphQL Query`);

      const authHeader = this.tokenType === 'oauth' ? `Bearer ${this.token}` : `bearer ${this.token}`;

      const response = await fetch(this.endpoint, {
        method: 'POST',
        headers: {
          'Authorization': authHeader,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ query: graphqlQuery })
      });

      if (!response.ok) {
        throw new Error(`GraphQL error: ${response.status}`);
      }

      const result = await response.json();

      if (result.errors) {
        console.error(`Better GHub v${BetterGHub_Constants.VERSION}: GraphQL Errors:`, result.errors);
        return null;
      }

      return result.data;
    } catch (error) {
      console.error(`Better GHub v${BetterGHub_Constants.VERSION}: GraphQL Error:`, error);
      return null;
    }
  }

  async getUnresolvedThreads(owner, repo, number) {
    const query = `
      query {
        repository(owner: "${owner}", name: "${repo}") {
          pullRequest(number: ${number}) {
            reviewThreads(first: 100) {
              nodes {
                isResolved
                isOutdated
                comments(first: 1) {
                  nodes {
                    author {
                      login
                    }
                  }
                }
              }
            }
          }
        }
      }
    `;

    const data = await this.query(query);
    if (!data?.repository?.pullRequest?.reviewThreads) {
      return { count: 0, byAuthor: {} };
    }

    const threads = data.repository.pullRequest.reviewThreads.nodes;
    const unresolvedThreads = threads.filter(t => !t.isResolved && !t.isOutdated);

    // Count by author
    const byAuthor = {};
    unresolvedThreads.forEach(thread => {
      const author = thread.comments?.nodes?.[0]?.author?.login || 'unknown';
      byAuthor[author] = (byAuthor[author] || 0) + 1;
    });

    console.log(`Better GHub v${BetterGHub_Constants.VERSION}: PR #${number}: ${unresolvedThreads.length} unresolved threads out of ${threads.length} total`);

    return {
      count: unresolvedThreads.length,
      byAuthor: byAuthor
    };
  }

  async getUnresolvedThreadsBatch(prList) {
    if (!this.token) {
      console.warn(`Better GHub v${BetterGHub_Constants.VERSION}: No token for GraphQL batch`);
      return {};
    }

    if (prList.length === 0) return {};

    console.log(`Better GHub v${BetterGHub_Constants.VERSION}: Batch fetching unresolved counts for ${prList.length} PRs`);

    // Build batch query with aliases
    let queryParts = [];
    prList.forEach((pr, index) => {
      queryParts.push(`
        pr${index}: repository(owner: "${pr.owner}", name: "${pr.repo}") {
          pullRequest(number: ${pr.number}) {
            reviewThreads(first: 100) {
              nodes {
                isResolved
                isOutdated
                comments(first: 1) {
                  nodes {
                    author {
                      login
                    }
                  }
                }
              }
            }
          }
        }
      `);
    });

    const query = `query { ${queryParts.join('\n')} }`;
    const data = await this.query(query);

    if (!data) return {};

    // Parse results
    const results = {};
    prList.forEach((pr, index) => {
      const key = `${pr.owner}/${pr.repo}/${pr.number}`;
      const prData = data[`pr${index}`];

      if (prData?.pullRequest?.reviewThreads) {
        const threads = prData.pullRequest.reviewThreads.nodes;
        const unresolvedThreads = threads.filter(t => !t.isResolved && !t.isOutdated);

        // Count by author
        const byAuthor = {};
        unresolvedThreads.forEach(thread => {
          const author = thread.comments?.nodes?.[0]?.author?.login || 'unknown';
          byAuthor[author] = (byAuthor[author] || 0) + 1;
        });

        results[key] = {
          count: unresolvedThreads.length,
          byAuthor: byAuthor
        };

        console.log(`Better GHub v${BetterGHub_Constants.VERSION}: PR #${pr.number}: ${unresolvedThreads.length} unresolved`);
      } else {
        results[key] = { count: 0, byAuthor: {} };
      }
    });

    return results;
  }
}
