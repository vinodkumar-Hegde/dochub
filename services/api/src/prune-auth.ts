import {PrismaClient} from '@prisma/client';
const db=new PrismaClient();
try{
 const now=new Date();
 const [codes,sessions,throttles]=await db.$transaction([
  db.loginChallenge.deleteMany({where:{OR:[{expiresAt:{lt:now}},{consumedAt:{not:null}}]}}),
  db.appSession.deleteMany({where:{OR:[{expiresAt:{lt:now}},{revokedAt:{not:null}}]}}),
  db.studentAuthThrottle.deleteMany({where:{expiresAt:{lt:now}}}),
 ]);
 console.log({expiredCodesRemoved:codes.count,expiredSessionsRemoved:sessions.count,expiredThrottlesRemoved:throttles.count});
}finally{await db.$disconnect()}
