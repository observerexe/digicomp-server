import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppThrottlerGuard } from './common/app-throttler.guard';
import { databaseOptions } from './database';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { HealthController } from './health/health.controller';
import { AdminPanelModule } from './admin-panel/admin-panel.module';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { DictionariesModule } from './dictionaries/dictionaries.module';
import { DocsModule } from './docs/docs.module';
import { BookingsModule } from './bookings/bookings.module';
import { DisciplineModule } from './discipline/discipline.module';
import { DocumentsModule } from './documents/documents.module';
import { FaultsModule } from './faults/faults.module';
import { FilesModule } from './files/files.module';
import { InventoryModule } from './inventory/inventory.module';
import { LinksModule } from './links/links.module';
import { OrgModule } from './org/org.module';
import { PaperworkModule } from './paperwork/paperwork.module';
import { ProjectsModule } from './projects/projects.module';
import { PlacesModule } from './places/places.module';
import { PointsModule } from './points/points.module';
import { RecordsModule } from './records/records.module';
import { SmartModule } from './smart/smart.module';
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
    DisciplineModule,
    PlacesModule,
    BookingsModule,
    FaultsModule,
    FilesModule,
    DocumentsModule,
    InventoryModule,
    ProjectsModule,
    SmartModule,
    DictionariesModule,
    RecordsModule,
    LinksModule,
    OrgModule,
    PaperworkModule,
    DocsModule,
    AdminPanelModule,
  ],
  controllers: [AppController, HealthController],
  providers: [AppService, { provide: APP_GUARD, useClass: AppThrottlerGuard }],
})
export class AppModule {}
