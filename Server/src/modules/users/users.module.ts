import { Module } from '@nestjs/common';
import { UserStatusService } from './user-status.service.js';
import { UsersController } from './users.controller.js';
import { UsersService } from './users.service.js';

@Module({
  controllers: [UsersController],
  providers: [UsersService, UserStatusService],
  exports: [UsersService, UserStatusService],
})
export class UsersModule {}
