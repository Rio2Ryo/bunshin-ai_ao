import { ENV } from './server/_core/env';

console.log('=== ENV Settings ===');
console.log('clawdbotGatewayUrl:', ENV.clawdbotGatewayUrl);
console.log('clawdbotAuthToken:', ENV.clawdbotAuthToken ? 'SET (length: ' + ENV.clawdbotAuthToken.length + ')' : 'NOT SET');
console.log('clawdbotAgentId:', ENV.clawdbotAgentId);
const isEnabled = !!(ENV.clawdbotGatewayUrl && ENV.clawdbotAuthToken);
console.log('isClawdbotEnabled():', isEnabled);
