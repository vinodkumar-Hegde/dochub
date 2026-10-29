/** Run as a separate scheduled maintenance job, not in request handlers.
 * Removes only expired ephemeral authentication records, never student
 * identities, subscription grants, password hashes, or audit events. */
import { PrismaClient } from '@prisma/client';
const db=new PrismaClient();
try {
  const now=new Date(),retention=new Date(now.getTime()-30*24*60*60*1000);
  const [tokens,throttles,sessions]=await db.$transaction([
    db.studentAuthToken.deleteMany({where:{expiresAt:{lt:retention}}}),
    db.studentAuthThrottle.deleteMany({where:{expiresAt:{lt:retention}}}),
    db.studentSession.deleteMany({where:{expiresAt:{lt:retention}}}),
  ]);
  process.stdout.write(`Expired student auth records purged: tokens=${tokens.count} throttles=${throttles.count} sessions=${sessions.count}\n`);
}finally{await db.$disconnect();}
