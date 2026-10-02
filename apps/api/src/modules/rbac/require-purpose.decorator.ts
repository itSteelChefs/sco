import { SetMetadata } from '@nestjs/common';
import type { PurposeRequirement } from './purpose-registry.js';

export const PURPOSE_KEY = 'sco:purpose';
export const RequirePurpose = (requirement: PurposeRequirement) => SetMetadata(PURPOSE_KEY, requirement);