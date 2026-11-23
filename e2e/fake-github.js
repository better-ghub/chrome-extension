// Installs a fake api.github.com inside the extension service worker by
// overriding self.fetch. Deterministic per PR number. No real token is used.
// usage: await sw.evaluate(installFakeGitHub, { viewer: 'octo-dev' })

function installFakeGitHub(opts) {
  const VIEWER = opts.viewer;
  const PEOPLE = ['alice', 'bob', 'carol', 'dmitri', 'eve', 'farah'];
  const rnd = (seed) => {
    let x = seed * 9301 + 49297;
    return () => ((x = (x * 9301 + 49297) % 233280) / 233280);
  };
  const ago = (h) => new Date(Date.now() - h * 3600 * 1000).toISOString();
  const headers = (resource) => ({
    'content-type': 'application/json',
    'x-ratelimit-limit': '5000',
    'x-ratelimit-remaining': '4821',
    'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 2400),
    'x-ratelimit-resource': resource,
  });

  function fakePR(number, owner = 'microsoft', repo = 'vscode') {
    const r = rnd(number);
    const pick = (arr) => arr[Math.floor(r() * arr.length)];
    const size = [3, 40, 260, 800, 2400][Math.floor(r() * 5)];
    const additions = Math.round(size * (0.4 + r() * 0.5));
    const deletions = size - additions;
    const author = pick(PEOPLE);
    const reviewers = PEOPLE.filter((p) => p !== author && r() > 0.7).slice(0, 2);
    if (number % 4 === 0) reviewers.unshift(VIEWER);
    const unresolved = Math.floor(r() * 4);
    const threads = [];
    for (let i = 0; i < unresolved + 2; i++) {
      threads.push({ isResolved: i >= unresolved, isOutdated: i === 0 && number % 5 === 0, comments: { nodes: [{ author: { login: pick(PEOPLE) } }] } });
    }
    const kinds = ['commit', 'comment', 'review'];
    const lastKind = kinds[number % 3];
    // Every 5th PR is ready to merge; every 7th is stale (20 days without activity).
    const ready = number % 5 === 0;
    const stale = number % 7 === 0;
    const act = (h) => ago(stale ? 480 + h : h);
    const files = ['src/app.ts', 'src/app.test.ts', 'docs/readme.md', 'package.json', '.github/workflows/ci.yml', 'src/styles/main.css'].filter(() => r() > 0.5);
    return {
      number,
      url: `https://github.com/${owner}/${repo}/pull/${number}`,
      // Realistic sample titles (the screenshots end up in the store listing).
      title: ['Add keyboard shortcut for the file finder', 'Fix flaky checkout test on Windows', 'Speed up diff rendering for large files', 'Show review progress in the header', 'Update dependencies and lockfile', 'Handle expired tokens gracefully', 'Refactor settings storage', 'Add dark mode to the options page', 'Improve error message for missing permissions', 'Cache GraphQL responses per repository', 'Remove deprecated API calls'][number % 11],
      additions,
      deletions,
      changedFiles: Math.max(1, Math.round(size / 60)),
      mergeable: ready ? 'MERGEABLE' : number % 6 === 1 ? 'CONFLICTING' : 'MERGEABLE',
      reviewDecision: ready ? 'APPROVED' : ['REVIEW_REQUIRED', 'APPROVED', 'CHANGES_REQUESTED'][number % 3],
      isDraft: false,
      createdAt: ago(200),
      updatedAt: act(number % 30),
      repository: { nameWithOwner: `${owner}/${repo}` },
      author: { login: author, avatarUrl: `https://avatars.githubusercontent.com/u/${1000 + (number % 50)}?v=4` },
      commits: {
        nodes: [
          {
            commit: {
              committedDate: act(lastKind === 'commit' ? 2 : 30),
              messageHeadline: 'Tighten up the thing',
              author: { name: author, user: { login: author } },
              statusCheckRollup: { state: ready ? 'SUCCESS' : ['SUCCESS', 'FAILURE', 'PENDING'][number % 3] },
            },
          },
        ],
      },
      reviewRequests: { nodes: reviewers.map((login) => ({ requestedReviewer: { __typename: 'User', login, avatarUrl: `https://github.com/${login}.png` } })) },
      timelineItems: { nodes: reviewers.map((login, i) => ({ createdAt: ago(20 + i * 30), requestedReviewer: { __typename: 'User', login } })) },
      comments: { nodes: [{ author: { login: pick(PEOPLE) }, createdAt: act(lastKind === 'comment' ? 1 : 40) }] },
      reviews: { nodes: [{ author: { login: pick(PEOPLE) }, submittedAt: act(lastKind === 'review' ? 3 : 50), state: ['APPROVED', 'CHANGES_REQUESTED', 'COMMENTED'][number % 3] }] },
      reviewThreads: { nodes: ready ? threads.map((t) => ({ ...t, isResolved: true })) : threads },
      files: { nodes: files.map((path) => ({ path })) },
    };
  }

  // Optional multi-token mode: opts.tokens = { '<token>': { login, owners: ['acme'] } } and
  // opts.privateOwners = ['microsoft'] → repos of those owners are readable only by tokens covering them.
  const TOKENS = opts.tokens || null;
  const PRIVATE = (opts.privateOwners || []).map((o) => o.toLowerCase());
  const tokenOf = (init) => {
    const h = init.headers || {};
    const auth = h.Authorization || h.authorization || '';
    return auth.replace(/^(Bearer|token)\s+/i, '');
  };
  const who = (init) => (TOKENS ? TOKENS[tokenOf(init)] : { login: VIEWER, owners: null });
  const canRead = (init, owner) => {
    if (!PRIVATE.includes(String(owner).toLowerCase())) return true;
    const w = who(init);
    return !!w && (w.owners === null || w.owners.map((o) => o.toLowerCase()).includes(String(owner).toLowerCase()));
  };
  self.__bghubAuthSeen = [];
  const realFetch = self.__bghubRealFetch || self.fetch.bind(self);
  self.__bghubRealFetch = realFetch;
  self.__bghubFakeCalls = [];
  self.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input.url;
    if (!url.startsWith('https://api.github.com')) return realFetch(input, init);
    const path = url.slice('https://api.github.com'.length);
    self.__bghubFakeCalls.push(path);
    const json = (body, resource = 'core', status = 200) => new Response(JSON.stringify(body), { status, headers: headers(resource) });
    self.__bghubAuthSeen.push(tokenOf(init).slice(-4) + ' ' + path.slice(0, 40));
    const w = who(init);
    if (TOKENS && !w) return json({ message: 'Bad credentials' }, 'core', 401);
    if (path.startsWith('/user/repos')) {
      const owners = (w && w.owners) || [];
      return json(owners.map((o, i) => ({ name: `private-${i}`, full_name: `${o}/private-${i}`, private: true, owner: { login: o } })));
    }
    if (path.startsWith('/user')) {
      const login = (w && w.login) || VIEWER;
      return new Response(JSON.stringify({ login, name: 'Octo Dev', avatar_url: 'https://avatars.githubusercontent.com/u/583231?v=4', html_url: `https://github.com/${login}` }), {
        status: 200,
        headers: { ...headers('core'), 'github-authentication-token-expiration': new Date(Date.now() + 5 * 86400000).toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC') },
      });
    }
    if (path.startsWith('/rate_limit')) return json({ rate: { limit: 5000, remaining: 4821, reset: Math.floor(Date.now() / 1000) + 2400, used: 179 } });
    if (path.startsWith('/graphql')) {
      const body = JSON.parse(init.body || '{}');
      const q = body.query || '';
      const v = body.variables || {};
      if (q.includes('BghubInbox')) {
        const mk = (nums) => ({ nodes: nums.map((n) => fakePR(n)).filter((pr) => canRead(init, pr.repository.nameWithOwner.split('/')[0])) });
        return json({ data: { viewer: { login: (w && w.login) || VIEWER, name: 'Octo Dev' }, authored: mk([349701, 349650, 349612]), reviewRequested: mk([349703, 349688, 349640, 349603]), assigned: mk([]) } }, 'graphql');
      }
      if (q.includes('BghubPRList')) {
        const data = {};
        const errors = [];
        for (const m of q.matchAll(/(pr\d+): repository\(owner: \$o(\d+), name: \$r\d+\)/g)) {
          const i = m[2];
          if (!canRead(init, v[`o${i}`])) {
            data[m[1]] = null;
            errors.push({ type: 'NOT_FOUND', path: [m[1]], message: `Could not resolve to a Repository with the name '${v[`o${i}`]}/${v[`r${i}`]}'.` });
            continue;
          }
          data[m[1]] = { pullRequest: fakePR(Number(v[`n${i}`]), v[`o${i}`], v[`r${i}`]) };
        }
        return json(errors.length ? { data, errors } : { data }, 'graphql');
      }
      return json({ data: {} }, 'graphql');
    }
    if (/^\/repos\/[^/]+\/[^/]+\/pulls\/\d+$/.test(path)) return json({ head: { ref: 'feature/fake', label: 'microsoft:feature/fake' } });
    return json({ message: 'Not Found' }, 'core', 404);
  };
  return 'installed';
}

module.exports = { installFakeGitHub };
