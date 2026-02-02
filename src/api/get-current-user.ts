// GET /user - Get current authenticated user

import { restCall } from './client';
import type { GitHubUser } from '../types';

export async function getCurrentUser(): Promise<GitHubUser | null> {
  return restCall<GitHubUser>('/user');
}
