from __future__ import annotations

import csv
import json
import random
from datetime import datetime, timedelta
from pathlib import Path

ROOT = Path(__file__).parent
DATA = ROOT / "estate"
CODE = ROOT / "system_context"
SEED = 42


def write_csv(name, rows):
    path = DATA / f"{name}.csv"
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)


def main():
    random.seed(SEED)
    DATA.mkdir(parents=True, exist_ok=True)
    CODE.mkdir(parents=True, exist_ok=True)

    regions = ["South", "West", "North", "East"]
    customers = []
    for i in range(1, 61):
        cust_no = f"C{i:04d}"
        customers.append({
            "cust_no": cust_no,
            "legal_name": f"Acme Customer {i}",
            "segment": random.choice(["Enterprise", "Mid-market", "SMB"]),
            "region": random.choice(regions),
            "external_ref": f"EXT-{10000+i}"
        })
    # Introduce one duplicate business name and one sparse external reference.
    customers[12]["legal_name"] = customers[11]["legal_name"]
    customers[25]["external_ref"] = ""
    write_csv("customer_master", customers)

    materials = []
    for i in range(1, 41):
        part = f"MAT-{i:04d}"
        materials.append({
            "part_number": part,
            "description": f"Industrial component {i}",
            "category": random.choice(["Pump", "Motor", "Valve", "Bearing"]),
            "legacy_code": f"L{i:04d}"
        })
    write_csv("material_master", materials)

    orders = []
    lines = []
    start = datetime(2026, 1, 1)
    for i in range(1, 181):
        order_no = f"SO-{i:05d}"
        buyer = random.choice(customers)["cust_no"]
        # 3 intentionally stale/unmatched customer references.
        if i in (44, 97, 151):
            buyer = f"OLD-C{i:04d}"
        order_date = start + timedelta(days=random.randint(0, 210))
        orders.append({
            "order_no": order_no,
            "buyer_ref": buyer,
            "ordered_at": order_date.isoformat(timespec="seconds"),
            "state": random.choice(["OPEN", "ALLOCATED", "SHIPPED", "CANCELLED"])
        })
        for line_no in range(1, random.randint(2, 5)):
            material = random.choice(materials)["part_number"]
            lines.append({
                "sales_doc": order_no,
                "line_no": line_no,
                "material_code": material,
                "qty": random.randint(1, 25),
                "unit_price": round(random.uniform(50, 2500), 2)
            })
    write_csv("sales_order", orders)
    write_csv("sales_order_line", lines)

    inventory = []
    for material in materials:
        for wh in ["BLR", "PUN", "CHE"]:
            sku = material["part_number"]
            # A few old SKU aliases create imperfect overlap.
            if random.random() < 0.04:
                sku = material["legacy_code"]
            inventory.append({
                "sku": sku,
                "warehouse": wh,
                "available_qty": random.randint(0, 180),
                "reorder_level": random.randint(10, 60)
            })
    write_csv("warehouse_stock", inventory)

    shipments = []
    for i, order in enumerate(orders, start=1):
        if order["state"] in ("SHIPPED", "ALLOCATED"):
            shipments.append({
                "shipment_id": f"SHP-{i:05d}",
                "sales_ref": order["order_no"],
                "carrier": random.choice(["BlueDart", "DHL", "Delhivery"]),
                "shipped_at": (datetime.fromisoformat(order["ordered_at"]) + timedelta(days=random.randint(1, 8))).isoformat(timespec="seconds")
            })
    write_csv("shipment", shipments)

    machines = []
    for i in range(1, 21):
        material_ref = random.choice(materials)["part_number"]
        machines.append({
            "asset_tag": f"EQ-{i:04d}",
            "material_ref": material_ref,
            "plant": random.choice(["Plant-A", "Plant-B"]),
            "commissioned_on": f"20{random.randint(18,24)}-{random.randint(1,12):02d}-01"
        })
    write_csv("machine_asset", machines)

    telemetry = []
    telemetry_start = datetime(2026, 7, 1)
    for machine in machines:
        for hour in range(0, 24 * 10, 6):
            ts = telemetry_start + timedelta(hours=hour)
            telemetry.append({
                "device_ref": machine["asset_tag"],
                "ts": ts.isoformat(timespec="seconds"),
                "temperature_c": round(random.gauss(62, 7), 2),
                "vibration_mm_s": round(max(0.2, random.gauss(3.2, 1.1)), 2),
                "power_kw": round(max(1, random.gauss(18, 4)), 2)
            })
    write_csv("telemetry", telemetry)

    maintenance = []
    for i, machine in enumerate(random.sample(machines, 10), start=1):
        event_time = telemetry_start + timedelta(days=random.randint(2, 9), hours=random.randint(0, 20))
        maintenance.append({
            "event_id": f"MNT-{i:04d}",
            "equipment_ref": machine["asset_tag"],
            "event_time": event_time.isoformat(timespec="seconds"),
            "event_type": random.choice(["INSPECTION", "BEARING_REPLACEMENT", "OVERHEAT", "VIBRATION_ALERT"]),
            "notes": random.choice(["scheduled", "abnormal vibration", "temperature excursion", "noise reported"])
        })
    write_csv("maintenance_event", maintenance)

    # Deliberate misleading lookup-like values: not a semantic relationship.
    fake = [{"code": f"C{i:04d}", "description": f"Cost centre {i}"} for i in range(1, 31)]
    write_csv("cost_centre_reference", fake)

    (CODE / "order_service.py").write_text(
        '''def create_order(buyer_ref, items, customer_repo, stock_repo, order_repo):\n'''
        '''    customer = customer_repo.find_by_number(buyer_ref)\n'''
        '''    for item in items:\n'''
        '''        stock_repo.available_for(item.material_code)\n'''
        '''    return order_repo.insert(buyer_ref, items)\n''',
        encoding="utf-8"
    )

    (CODE / "fulfilment.sql").write_text(
        '''SELECT o.order_no, c.legal_name, l.material_code, s.available_qty\n'''
        '''FROM sales_order o\n'''
        '''JOIN customer_master c ON o.buyer_ref = c.cust_no\n'''
        '''JOIN sales_order_line l ON l.sales_doc = o.order_no\n'''
        '''JOIN warehouse_stock s ON s.sku = l.material_code;\n''',
        encoding="utf-8"
    )

    (CODE / "asset_mapping.json").write_text(json.dumps({
        "integration": "asset-product-link",
        "source": "material_master.part_number",
        "target": "machine_asset.material_ref",
        "meaning": "installed product model"
    }, indent=2), encoding="utf-8")

    (CODE / "telemetry_pipeline.json").write_text(json.dumps({
        "pipeline": "machine-telemetry",
        "source_id": "machine_asset.asset_tag",
        "event_id": "telemetry.device_ref",
        "maintenance_id": "maintenance_event.equipment_ref"
    }, indent=2), encoding="utf-8")

    manifest = {
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "seed": SEED,
        "datasets": sorted(p.stem for p in DATA.glob("*.csv")),
        "system_context": sorted(p.name for p in CODE.iterdir())
    }
    (ROOT / "estate_manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print(json.dumps(manifest, indent=2))


if __name__ == "__main__":
    main()
