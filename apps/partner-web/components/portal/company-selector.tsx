'use client';

import type { ActiveCompany } from '@sco/contracts';
import styles from '../readiness/readiness.module.css';

type Props = {
  companies: ActiveCompany[];
  selected: string;
  onSelect: (companyId: string) => void;
};

export function CompanySelector({ companies, selected, onSelect }: Props) {
  return (
    <div className={styles.companyBar}>
      <label htmlFor="portal-company">
        الشركة
        <select
          id="portal-company"
          aria-label="الشركة"
          value={selected}
          onChange={(event) => onSelect(event.target.value)}
        >
          <option value="" disabled>
            اختر الشركة النشطة
          </option>
          {companies.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
