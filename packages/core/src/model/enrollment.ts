import type {
  CubeId,
  EnrollmentId,
  FridayId,
  ISO8601,
  UserId,
} from "../ids.js";

export type Enrollment = {
  readonly id: EnrollmentId;
  readonly fridayId: FridayId;
  readonly cubeId: CubeId;
  readonly hostId: UserId;
  readonly createdAt: ISO8601;
  readonly withdrawn: boolean;
};
