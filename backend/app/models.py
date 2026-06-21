from pydantic import BaseModel
from typing import Optional


class PricePoint(BaseModel):
    date: str      # e.g. "0621"
    price: Optional[float] = None  # None means no quote


class SingleItem(BaseModel):
    name: str
    brand: str
    prices: list[PricePoint]  # sorted by date


class BrandGroup(BaseModel):
    brand: str
    items: list[SingleItem]


class DashboardData(BaseModel):
    brands: list[BrandGroup]
