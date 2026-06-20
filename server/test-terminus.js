const { HealthIndicatorSession } = require('@nestjs/terminus/dist/health-indicator/health-indicator.service');
const session = new HealthIndicatorSession('test');
console.log(session.down({ message: 'failed' }));
