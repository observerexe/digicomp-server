import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppThrottlerGuard } from './common/app-throttler.guard';
import { databaseOptions } from './database';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { HealthController } from './health/health.controller';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { DocumentsModule } from './documents/documents.module';
import { FilesModule } from './files/files.module';
import { InventoryModule } from './inventory/inventory.module';
import { ProjectsModule } from './projects/projects.module';
import { PlacesModule } from './places/places.module';
import { PointsModule } from './points/points.module';
import { TasksModule } from './tasks/tasks.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    TypeOrmModule.forRoot({
      ...databaseOptions,
      autoLoadEntities: true,
      synchronize: false,
      migrationsRun: true,
    }),
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 300 }]),
    UsersModule,
    AuthModule,
    AuditModule,
    PointsModule,
    TasksModule,
    PlacesModule,
    FilesModule,
    DocumentsModule,
    InventoryModule,
    ProjectsModule,
  ],
  controllers: [AppController, HealthController],
  providers: [AppService, { provide: APP_GUARD, useClass: AppThrottlerGuard }],
})
export class AppModule {}
