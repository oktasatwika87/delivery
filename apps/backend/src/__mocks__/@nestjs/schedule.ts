// Mock @nestjs/schedule, prevents @Cron decorators from being registered
// in unit tests. The ReassignmentService is tested by directly calling
// checkReassignments(), the @Cron decorator is a no-op in tests.

// ts-jest needs the mock to be a proper decorator function
export const Cron = () => (target: any, propertyKey: string, descriptor: PropertyDescriptor) => descriptor;
export const CronExpression = {
  EVERY_MINUTE: 'every-minute',
};

export const ScheduleModule = {
  forRoot: jest.fn(() => ({
    module: 'ScheduleModule',
  })),
};
