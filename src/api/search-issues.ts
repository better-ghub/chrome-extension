// GET /search/issues - Search issues and PRs

import { restCall } from './client';

export interface SearchIssuesResponse {
  total_count: number;
  items: Array<{
    html_url: string;
    repository_url?: string;
    title?: string;
    number?: number;
    comments?: number;
    draft?: boolean;
    updated_at?: string;
    created_at?: string;
  }>;
}

export async function searchIssues(query: string, perPage = 10): Promise<SearchIssuesResponse> {
  const result = await restCall<SearchIssuesResponse>(
    `/search/issues?q=${encodeURIComponent(query)}&per_page=${perPage}`
  );
  return result || { total_count: 0, items: [] };
}
