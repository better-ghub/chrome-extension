// Base API Client - shared token management

import { Constants } from '../constants';
import { apiMetrics } from './metrics';
import type { TokenType } from '../types';

const BASE_URL = 'https://api.github.com';
const GRAPHQL_URL = 'https://api.github.com/graphql';

// Shared state
let token: string | null = null;
let tokenType: TokenType = 'pat';

export function setToken(newToken: string | null, newType: TokenType = 'pat'): void {
  token = newToken;
  tokenType = newType;
}

export function getToken(): { token: string | null; tokenType: TokenType } {
  return { token, tokenType };
}

function getAuthHeader(forGraphQL = false): string {
  if (tokenType === 'oauth') return `Bearer ${token}`;
  return forGraphQL ? `bearer ${token}` : `token ${token}`;
}

// REST API call
export async function restCall<T>(endpoint: string): Promise<T | null> {
  try {
    apiMetrics.incrementCall('rest', endpoint);

    const headers: Record<string, string> = {
      Accept: 'application/vnd.github.v3+json',
    };

    if (token) {
      headers['Authorization'] = getAuthHeader();
    }

    console.log(`Better GHub v${Constants.VERSION}: REST ${endpoint}`);

    const response = await fetch(`${BASE_URL}${endpoint}`, { headers });

    if (!response.ok) {
      throw new Error(`GitHub API error: ${response.status}`);
    }

    return (await response.json()) as T;
  } catch (error) {
    console.error(`Better GHub: REST Error:`, error);
    return null;
  }
}

// GraphQL API call
export async function graphqlCall<T>(query: string): Promise<T | null> {
  if (!token) {
    console.warn(`Better GHub: No token for GraphQL`);
    return null;
  }

  try {
    apiMetrics.incrementCall('graphql', 'query');
    console.log(`Better GHub v${Constants.VERSION}: GraphQL Query`);

    const response = await fetch(GRAPHQL_URL, {
      method: 'POST',
      headers: {
        Authorization: getAuthHeader(true),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query }),
    });

    if (!response.ok) {
      throw new Error(`GraphQL error: ${response.status}`);
    }

    const result = await response.json();

    if (result.errors) {
      console.error(`Better GHub: GraphQL Errors:`, result.errors);
      return null;
    }

    return result.data as T;
  } catch (error) {
    console.error(`Better GHub: GraphQL Error:`, error);
    return null;
  }
}

export function getApiCallCount(): number {
  return apiMetrics.getCount();
}
