import { Module, OnModuleInit } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditModule } from '../audit/audit.module';
import { FilesModule } from '../files/files.module';
import { LinkRegistry } from '../links/link-registry';
import { LinksModule } from '../links/links.module';
import { SessionsModule } from '../sessions/sessions.module';
import { User } from './user.entity';
import { USER_LINKS } from './user.links';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([User]),
    AuditModule,
    SessionsModule,
    FilesModule,
    LinksModule,
  ],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [TypeOrmModule, UsersService],
})
export class UsersModule implements OnModuleInit {
  constructor(private links: LinkRegistry) {}

  onModuleInit() {
    this.links.register('user', USER_LINKS);
  }
}
