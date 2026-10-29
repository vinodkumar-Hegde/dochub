-- A single immutable student intention per published session.
CREATE TYPE "StudentAttendanceIntent" AS ENUM ('WILL_ATTEND', 'NOT_AVAILABLE', 'WATCH_RECORDING');

CREATE TABLE "StudentSessionResponse" (
  "userId" UUID NOT NULL,
  "sessionId" UUID NOT NULL,
  "response" "StudentAttendanceIntent" NOT NULL,
  "markedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "StudentSessionResponse_pkey" PRIMARY KEY ("userId", "sessionId")
);

CREATE INDEX "StudentSessionResponse_sessionId_idx" ON "StudentSessionResponse"("sessionId");
ALTER TABLE "StudentSessionResponse" ADD CONSTRAINT "StudentSessionResponse_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StudentSessionResponse" ADD CONSTRAINT "StudentSessionResponse_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "LiveSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
