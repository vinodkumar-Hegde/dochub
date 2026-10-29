#!/usr/bin/env bash
set -euo pipefail
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT/services/api"
node --env-file=.env --input-type=module <<'JS'
import {SESv2Client,GetAccountCommand,GetEmailIdentityCommand} from '@aws-sdk/client-sesv2';
const client=new SESv2Client({region:process.env.AWS_REGION});
try{
 if(!process.env.SES_FROM_EMAIL)throw new Error('SES_FROM_EMAIL is missing');
 const account=await client.send(new GetAccountCommand({}));
 const sender=await client.send(new GetEmailIdentityCommand({EmailIdentity:process.env.SES_FROM_EMAIL}));
 console.log({sendingEnabled:account.SendingEnabled,productionAccess:account.ProductionAccessEnabled,senderVerified:sender.VerifiedForSendingStatus});
}finally{client.destroy()}
JS
