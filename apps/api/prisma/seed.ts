import { PrismaClient, CompanyType, CompanyStatus, UserStatus, MembershipStatus } from '@prisma/client';
import argon2 from 'argon2';
import { randomBytes } from 'node:crypto';

if (process.env.NODE_ENV === 'production') {
  throw new Error('Prisma seed is disabled when NODE_ENV=production');
}

const prisma = new PrismaClient();
const seedPassword = process.env.SCO_SEED_PASSWORD ?? randomBytes(32).toString('base64url');

async function main() {
  const passwordHash = await argon2.hash(seedPassword);
  const sco = await prisma.company.upsert({
    where: { id: '10000000-0000-4000-8000-000000000001' },
    update: { name: 'SCO Development', type: CompanyType.SCO, status: CompanyStatus.ACTIVE },
    create: { id: '10000000-0000-4000-8000-000000000001', name: 'SCO Development', type: CompanyType.SCO },
  });
  const partner = await prisma.company.upsert({
    where: { id: '10000000-0000-4000-8000-000000000002' },
    update: { name: 'Partner Development', type: CompanyType.PARTNER, status: CompanyStatus.ACTIVE },
    create: { id: '10000000-0000-4000-8000-000000000002', name: 'Partner Development', type: CompanyType.PARTNER },
  });
  const user = await prisma.user.upsert({
    where: { email: 'seed.owner@sco.test' },
    update: { passwordHash, status: UserStatus.ACTIVE },
    create: { id: '10000000-0000-4000-8000-000000000010', email: 'seed.owner@sco.test', passwordHash },
  });
  await prisma.companyMembership.upsert({
    where: { userId_companyId: { userId: user.id, companyId: sco.id } },
    update: { status: MembershipStatus.ACTIVE },
    create: { userId: user.id, companyId: sco.id, status: MembershipStatus.ACTIVE },
  });
  await prisma.companyMembership.upsert({
    where: { userId_companyId: { userId: user.id, companyId: partner.id } },
    update: { status: MembershipStatus.ACTIVE },
    create: { userId: user.id, companyId: partner.id, status: MembershipStatus.ACTIVE },
  });
}

main().finally(() => prisma.$disconnect());
