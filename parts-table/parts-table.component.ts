import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  Input,
  OnChanges,
  OnInit,
  Output,
  SimpleChanges
} from '@angular/core';
import { MatCheckboxChange } from '@angular/material/checkbox';
import { MatDialog } from '@angular/material/dialog';

import { Customer } from '../../interfaces/customer.interface';
import { CategorizedPart, CheckedPartsDetailsData, DividedParts, Part } from '../../interfaces/part.interface';
import { PartIndexData, SNRCategory, TOR } from '../../interfaces/serial-number-range.interface';
import { WarehouseDetails } from '../../interfaces/warehouse.interface';
import { CheckedPartsDetailsComponent } from '../checked-parts-details/checked-parts-details.component';


@Component({
  selector: 'app-parts-table',
  templateUrl: './parts-table.component.html',
  styleUrls: ['./parts-table.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class PartsTableComponent implements OnInit, OnChanges {
  @Input() categories: SNRCategory[] = [];
  @Input() partsPrices: CategorizedPart[] = [];
  @Input() customer: Customer;
  @Input() warehouse: WarehouseDetails;
  @Input() uKeyPrefix: string;
  @Input() categorySelection: { checked: boolean, category: SNRCategory };
  @Output() partSelectionChanged: EventEmitter<{
    part: Part,
    checked: boolean,
    category: SNRCategory,
    categoryChecked: boolean
  }> = new EventEmitter();


  public repairTypes: TOR[];
  public torColumns: string[];
  public partsMatrix: { [torKey: string]: { [categoryTitle: string]: DividedParts<Part> } };
  public selectedParts: Map<string, CategorizedPart> = new Map();
  public checkedParts: Map<string, CategorizedPart> = new Map(); // Parts with price after checking availability

  public categoriesById: { [categoryId: string]: { categoryId: string, title: string } } = {};
  public torsById: { [torId: string]: Partial<TOR> } = {};

  constructor(private dialog: MatDialog) {
  }

  ngOnInit() {
  }

  ngOnChanges(changes: SimpleChanges) {
    if (changes.categories && changes.categories.currentValue) {
      this.clearSelections();
      this.createPartsMatrix();
    }

    if (changes.partsPrices && changes.partsPrices.currentValue) {
      this.updatePricesInfo();
    }

    if (changes.categorySelection && changes.categorySelection.currentValue) {
      this.changeSelectionOnPartsInCategory();
    }
  }

  public getUKey(categoryId: string, torId: string, part: Part): string {
    return `${this.uKeyPrefix}_${categoryId}_${torId}_${part.partNumber}_${part.sOS}`;
  }

  public isSelected(category: SNRCategory, torId: string, part: Part): boolean {
    return this.selectedParts.has(this.getUKey(category.categoryId, torId, part));
  }

  public isChecked(category: SNRCategory, torId: string, part: Part): boolean {
    return this.checkedParts.has(this.getUKey(category.categoryId, torId, part));
  }

  public onPartSelectionChanged(
    event: MatCheckboxChange,
    category: SNRCategory,
    torId: string,
    part: Part,
    allPartsForSelectedTOR: DividedParts<Part> = { included: [], excluded: [] }
  ): void {
    const parts = [...allPartsForSelectedTOR.included, ...allPartsForSelectedTOR.excluded];

    this.updateSelectedParts([part, ...parts], category.categoryId, torId, event.checked);

    this.partSelectionChanged.emit({
      part,
      checked: event.checked,
      category,
      categoryChecked: this.isAllPartsInCategorySelected(category)
    });
  }

  public getCheckedPart(category: SNRCategory, torId: string, part: Part): CategorizedPart {
    return this.checkedParts.get(this.getUKey(category.categoryId, torId, part));
  }

  public qtyChanged(qty: number): void {
    this.clearChecked();
    this.selectedParts.forEach(val => val.qty = qty);
  }

  public stopPropagation(e: MouseEvent): void {
    e.stopPropagation();
  }

  public showDetails(category: SNRCategory,
                     torId: string,
                     checkedPart: CategorizedPart,
                     parts: DividedParts<Part>): void {
    const partsWithInfo: DividedParts<CategorizedPart> = {
      included: parts.included.map(p => this.getCheckedPart(category, torId, p)),
      excluded: parts.excluded
        .map((p: CategorizedPart) => this.getCheckedPart(category, torId, p))
        .map((p: CategorizedPart) => ({...p, qty: 1 } as CategorizedPart))
    };

    const data: CheckedPartsDetailsData = {
      partsWithInfo,
      currency: this.customer.currency,
      warehouse: this.warehouse.warehouse,
      category,
      tor: this.torsById[torId]
    };
    this.dialog.open<CheckedPartsDetailsComponent, CheckedPartsDetailsData>(CheckedPartsDetailsComponent, {
      data,
      disableClose: true,
      minWidth: '400px',
      panelClass: 'edit-dialog'
    }).afterClosed();
  }

  private clearChecked(): void {
    this.checkedParts = new Map();
  }

  private isAllPartsInCategorySelected(category: SNRCategory): boolean {
    return category.repairTypes.map((tor: TOR) => {
      return [...tor.partsIncluded, ...tor.partsExcluded]
        .every((p: Part) => this.selectedParts.has(this.getUKey(category.categoryId, tor.torId, p)));
    }).every((isAllPartsInTORSelected: boolean) => isAllPartsInTORSelected);
  }

  private changeSelectionOnPartsInCategory(): void {
    const { checked, category } = this.categorySelection;

    category.repairTypes
      .forEach((tor: TOR) => this.updateSelectedParts(
        [...tor.partsIncluded, ...tor.partsExcluded],
        category.categoryId,
        tor.torId,
        checked)
      );
  }

  private updateSelectedParts(parts: PartIndexData[], categoryId: string, torId: string, checked: boolean): void {
    parts.forEach((p: Part) => {
      const uKey = this.getUKey(categoryId, torId, p);
      const selectedPreviouslyPart = this.selectedParts.get(uKey);

      if (checked) {
        p.qty = selectedPreviouslyPart ? selectedPreviouslyPart.qty : 1;
        this.selectedParts.set(uKey, {
          categoryId,
          torId,
          ...p
        });
      } else {
        this.selectedParts.delete(uKey);
      }
    });
  }

  private clearSelections(): void {
    this.selectedParts = new Map();
    this.clearChecked();
  }

  private createPartsMatrix(): void {
    const partsMatrix = {};
    if (!this.categories) {
      this.torColumns = [];
      return;
    }

    this.categories.forEach((category: SNRCategory) => {
      const { repairTypes, categoryId, title: categoryTitle } = category;

      if (!repairTypes) {
        return;
      }

      this.categoriesById[categoryId] = { categoryId, title: categoryTitle };

      repairTypes.forEach((repairType: TOR) => {
        const { partsIncluded, partsExcluded, torId, title: TORTitle } = repairType;

        this.torsById[torId] = { torId, title: TORTitle };

        if (!partsMatrix[torId]) {
          partsMatrix[torId] = { [categoryId]: {} };
        }

        if (!partsMatrix[torId][categoryId]) {
          partsMatrix[torId][categoryId] = {};
        }

        partsMatrix[torId][categoryId].included = partsIncluded;
        partsMatrix[torId][categoryId].excluded = partsExcluded.map(p => {
          p.isExcluded = true;
          return p;
        });
      });
    });

    this.partsMatrix = partsMatrix;
    this.torColumns = Object.keys(partsMatrix)
      .map(key => ({ key, count: Object.keys(partsMatrix[key]).length }))
      .sort((a, b) => {
        return b.count - a.count;
      })
      .map(item => item.key);
  }

  private updatePricesInfo(): void {
    this.checkedParts = new Map();
    this.partsPrices.forEach((p: CategorizedPart) => {
      this.checkedParts.set(this.getUKey(p.categoryId, p.torId, p), p);
    });
  }

}
