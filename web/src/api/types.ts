import type { components } from './schema';

/** Response shapes from the OpenAPI document (npm run api:types). */
type S = components['schemas'];

export type Role = S['Role'];
export type Me = S['MeDto'];
export type UserListItem = S['UserListItemDto'];
export type UserDetail = S['UserDetailDto'];
export type PointsHistory = S['PointsHistoryDto'];
export type PointsHistoryEntry = S['PointsHistoryEntryDto'];
export type LeaderboardRow = S['LeaderboardRowDto'];
export type DisciplineRecord = S['DisciplineRecordDto'];
export type Booking = S['BookingDto'];
export type Authorization = S['AuthorizationDto'];
export type Task = S['TaskDto'];
export type TaskStatus = S['TaskStatus'];
export type ProjectListItem = S['ProjectListItemDto'];
export type ProjectStage = S['ProjectStage'];

/** Login is not described in OpenAPI yet (the body depends on the client). */
export type LoginResult =
  | { user: Me }
  | { twoFactorRequired: true; challengeToken: string };
