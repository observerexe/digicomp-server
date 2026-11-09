/**
 * Response shapes the OpenAPI document does not describe yet (responses are
 * added per section in stage 8). Keep in sync with api/src/users/profile.ts.
 */
export type Role = 'admin' | 'moderator' | 'member';

export type Me = {
  id: string;
  email: string;
  name: string;
  role: Role;
  position: string;
  specialty: string;
  bio: string;
  avatarUrl: string | null;
  active: boolean;
  twoFactorEnabled: boolean;
  permissions: string[];
};

export type LoginResult =
  | { user: Me }
  | { twoFactorRequired: true; challengeToken: string };
