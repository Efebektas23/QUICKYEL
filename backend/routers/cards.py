"""Payment cards management router."""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from typing import List
from uuid import UUID

from database import get_db
from models import User, Card
from schemas import CardCreate, CardResponse
from routers.auth import get_current_user

router = APIRouter()


@router.get("/", response_model=List[CardResponse])
async def list_cards(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """List all cards for the current user."""
    result = await db.execute(
        select(Card)
        .where(Card.user_id == current_user.id)
        .order_by(Card.created_at.desc())
    )
    cards = result.scalars().all()
    return [CardResponse.model_validate(c) for c in cards]


@router.post("/", response_model=CardResponse, status_code=status.HTTP_201_CREATED)
async def create_card(
    card_data: CardCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Add a new payment card."""
    # Check if card with same last 4 already exists for this user
    result = await db.execute(
        select(Card).where(
            Card.user_id == current_user.id,
            Card.last_four == card_data.last_four
        )
    )
    existing = result.scalar_one_or_none()
    
    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Card with these last 4 digits already exists"
        )
    
    new_card = Card(
        user_id=current_user.id,
        last_four=card_data.last_four,
        card_name=card_data.card_name,
        is_company_card=card_data.is_company_card
    )
    
    db.add(new_card)
    await db.commit()
    await db.refresh(new_card)
    
    return CardResponse.model_validate(new_card)


@router.get("/{card_id}", response_model=CardResponse)
async def get_card(
    card_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Get a specific card."""
    result = await db.execute(
        select(Card).where(
            Card.id == card_id,
            Card.user_id == current_user.id
        )
    )
    card = result.scalar_one_or_none()
    
    if not card:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Card not found"
        )
    
    return CardResponse.model_validate(card)


@router.delete("/{card_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_card(
    card_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Delete a payment card."""
    result = await db.execute(
        select(Card).where(
            Card.id == card_id,
            Card.user_id == current_user.id
        )
    )
    card = result.scalar_one_or_none()
    
    if not card:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Card not found"
        )
    
    await db.delete(card)
    await db.commit()


async def match_card(db: AsyncSession, user_id: UUID, last_four: str) -> tuple:
    """
    Match card last 4 digits to a user's registered cards.
    
    Returns:
        Tuple of (payment_source, is_company_card)
    """
    if not last_four:
        return ("unknown", False)
    
    result = await db.execute(
        select(Card).where(
            Card.user_id == user_id,
            Card.last_four == last_four
        )
    )
    card = result.scalar_one_or_none()
    
    if card:
        source = "company_card" if card.is_company_card else "personal_card"
        return (source, card.is_company_card)
    
    return ("unknown", False)

