#!/usr/bin/env python3
"""
Run from dm-sales-app/backend folder:
  python3 update_remember_data.py
"""
import json

# Load Remember data
with open('remember_eans.json', 'r') as f:
    remember_eans = json.load(f)

with open('remember_pack_qtys.json', 'r') as f:
    remember_pack_qtys = json.load(f)

# Load existing data
with open('eans.json', 'r') as f:
    existing_eans = json.load(f)

with open('pack_quantities.json', 'r') as f:
    existing_pack_qtys = json.load(f)

print(f"Existing EANs: {len(existing_eans)}")
print(f"Existing Pack Qtys: {len(existing_pack_qtys)}")

# Merge - Remember data takes precedence
merged_eans = {**existing_eans, **remember_eans}
merged_pack_qtys = {**existing_pack_qtys, **remember_pack_qtys}

print(f"\nAdding {len(remember_eans)} Remember EANs")
print(f"Adding {len(remember_pack_qtys)} Remember Pack Qtys")

# Save merged files
with open('eans.json', 'w') as f:
    json.dump(merged_eans, f, indent=2)

with open('pack_quantities.json', 'w') as f:
    json.dump(merged_pack_qtys, f, indent=2)

print(f"\n✓ Updated eans.json: {len(merged_eans)} total")
print(f"✓ Updated pack_quantities.json: {len(merged_pack_qtys)} total")
