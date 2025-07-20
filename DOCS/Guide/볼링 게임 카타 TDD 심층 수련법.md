---
tags:
  - GenAI
aliases:
cssclasses:
created: 2025-07-19 17:35:59 +09:00
updated: 2025-07-19 17:36:00 +09:00
---
# 볼링 게임 카타: AI 개발 에이전트를 위한 TDD 심층 수련법

## I. 서론: 카타(Kata), 수련을 통한 체화

가라테의 '카타(Kata)'는 정해진 형식과 동작을 반복 수련하여 기술을 무의식적인 수준으로 몸에 익히는 훈련법입니다. 소프트웨어 개발에서의 **코드 카타(Code Kata)** 역시 마찬가지입니다. 간단한 프로그래밍 문제를 반복적으로 해결하면서, 좋은 설계 원칙과 개발 습관, 그리고 도구 사용법을 근육 기억처럼 체화하는 과정입니다.

그중에서도 **볼링 게임 카타(Bowling Game Kata)**는 테스트 주도 개발(TDD)을 수련하기 위한 가장 고전적이고 효과적인 카타로 손꼽힙니다.

### 왜 볼링 게임 카타가 TDD 수련에 탁월한가?

1. **명확한 요구사항:** 볼링 규칙은 대부분의 사람들이 알거나 쉽게 이해할 수 있을 정도로 명확하고 잘 정의되어 있습니다. 복잡한 도메인 지식 없이 TDD 사이클 자체에 집중할 수 있습니다.
    
2. **점진적 복잡성:** 처음에는 단순히 핀을 더하는 간단한 문제처럼 보이지만, '스페어(Spare)'와 '스트라이크(Strike)'라는 규칙이 등장하면서 점진적으로 복잡성이 증가합니다. 이는 TDD의 핵심인 '작은 단계(Baby Steps)'를 밟아나가며 설계를 발전시키는 과정을 경험하기에 이상적입니다.
    
3. **경계 조건(Edge Cases)의 존재:** 마지막 10번째 프레임의 특수한 보너스 롤 규칙은 프로그램의 경계 조건을 다루는 테스트를 작성하는 좋은 연습이 됩니다.
    

이 카타의 목표는 볼링 점수 계산 프로그램을 '완성'하는 것이 아닙니다. 진짜 목표는 **"Red-Green-Refactor"** 라는 TDD의 심장 박동과 같은 리듬을 느끼고, 그 리듬에 맞춰 코드를 쌓아 올리는 감각을 익히는 것입니다.

이 문서는 AI 개발 에이전트가 볼링 게임 카타를 통해 TDD의 원칙과 흐름을 깊이 이해하고, 이를 코드 생성 로직의 일부로 통합하는 것을 돕기 위해 작성되었습니다.

## II. 규칙 요약: 우리가 해결할 문제

TDD를 시작하기 전, 요구사항인 볼링 규칙을 명확히 해야 합니다.

- **게임 구성:** 한 게임은 10개의 **프레임(Frame)**으로 구성됩니다.
    
- **투구(Roll):** 각 프레임에서 플레이어는 최대 두 번까지 공을 굴릴 수 있습니다.
    
- **점수:** 점수는 쓰러뜨린 핀의 개수입니다.
    
- **오픈 프레임(Open Frame):** 한 프레임의 두 번의 투구로 10개의 핀을 모두 쓰러뜨리지 못한 경우, 해당 프레임의 점수는 단순히 쓰러뜨린 핀의 합입니다.
    
- **스페어(Spare):** 한 프레임의 두 번째 투구에서 남은 핀을 모두 쓰러뜨린 경우입니다.
    
    - **보너스:** 스페어 처리한 프레임의 점수는 10점에 더해, **다음 한 번의 투구**에서 쓰러뜨린 핀의 개수를 추가로 더합니다.
        
- **스트라이크(Strike):** 한 프레임의 첫 번째 투구에서 10개의 핀을 모두 쓰러뜨린 경우입니다. 해당 프레임의 투구는 그것으로 끝납니다.
    
    - **보너스:** 스트라이크 처리한 프레임의 점수는 10점에 더해, **다음 두 번의 투구**에서 쓰러뜨린 핀의 개수를 추가로 더합니다.
        
- **10번째 프레임:**
    
    - 10번째 프레임에서 스페어를 기록하면, 보너스로 한 번 더 투구할 수 있습니다.
        
    - 10번째 프레임에서 스트라이크를 기록하면, 보너스로 두 번 더 투구할 수 있습니다.
        
    - 이 보너스 투구는 점수 계산을 위한 것이며, 추가 프레임을 만들지는 않습니다.
        
- **최고 점수:** 모든 투구가 스트라이크인 '퍼펙트 게임'의 점수는 300점입니다.
    

## III. TDD 사이클 실전: Red-Green-Refactor

이제 TDD의 심장 박동을 따라가며 코드를 만들어 보겠습니다. 모든 단계는 **RED(실패하는 테스트 작성) -> GREEN(테스트를 통과하는 최소한의 코드 작성) -> REFACTOR(코드 개선)** 의 순서를 엄격히 따릅니다.

### 1단계: 최악의 게임 (Gutter Game)

가장 간단한 시나리오부터 시작합니다. 공을 20번 굴려 단 하나의 핀도 맞추지 못한 경우입니다.

- **[RED] 실패하는 테스트 작성:**
    
    - **목표:** 20번 모두 0점을 기록한 게임의 총점은 0점이어야 한다.
        
    - **테스트 코드 (의사코드):**
        
        ```
        class BowlingGameTest:
            def test_gutter_game(self):
                game = Game()
                # 20번의 투구, 모두 0핀
                for i in range(20):
                    game.roll(0)
                # 총점은 0점이어야 함
                assert game.score() == 0
        ```
        
    - **결과:** `Game` 클래스도, `roll` 메서드도, `score` 메서드도 없으므로 이 코드는 컴파일조차 되지 않거나, 실행 시 오류를 발생시킵니다. 이것이 우리가 원하는 **RED** 상태입니다.
        
- **[GREEN] 테스트 통과시키기:**
    
    - **목표:** 위 테스트를 통과시키는 가장 적은 양의 코드를 작성한다.
        
    - **실제 코드:**
        
        ```
        class Game:
            def roll(self, pins):
                pass # 아직 아무것도 할 필요 없음
        
            def score(self):
                return 0 # 가장 간단한 방법!
        ```
        
    - **결과:** 이제 테스트가 통과합니다. `score` 메서드가 항상 0을 반환하므로, `test_gutter_game`은 성공합니다. 우리는 **GREEN** 상태에 도달했습니다.
        
- **[REFACTOR] 코드 개선:**
    
    - **목표:** 현재 코드와 테스트를 살펴보고 개선할 점이 있는지 확인한다.
        
    - **분석:** 코드가 너무 단순해서 아직 리팩토링할 것이 없습니다. 이름도 명확하고 중복도 없습니다. 이 단계에서는 넘어갑니다.
        

### 2단계: 전부 1점짜리 게임

- **[RED] 실패하는 테스트 작성:**
    
    - **목표:** 20번 모두 1핀씩만 쓰러뜨린 게임의 총점은 20점이어야 한다.
        
    - **테스트 코드:**
        
        ```
        class BowlingGameTest:
            # ... 기존 test_gutter_game ...
            def test_all_ones(self):
                game = Game()
                # 20번의 투구, 모두 1핀
                for i in range(20):
                    game.roll(1)
                assert game.score() == 20
        ```
        
    - **결과:** `score()`가 여전히 0을 반환하므로, 이 테스트는 실패합니다 (`AssertionError: 20 != 0`). 다시 **RED** 상태입니다.
        
- **[GREEN] 테스트 통과시키기:**
    
    - **목표:** `test_all_ones`를 통과시켜야 합니다. 이제 점수를 '기억'해야 할 필요가 생겼습니다.
        
    - **실제 코드:**
        
        ```
        class Game:
            def __init__(self):
                self._score = 0
        
            def roll(self, pins):
                self._score += pins # 들어온 핀을 그냥 더한다
        
            def score(self):
                return self._score
        ```
        
    - **결과:** 이 코드는 `test_all_ones`를 통과시킵니다. 그런데, 기존의 `test_gutter_game`도 여전히 통과하는지 확인해야 합니다. 20번 0을 더하면 0이므로, 두 테스트 모두 통과합니다. **GREEN** 입니다.
        
- **[REFACTOR] 코드 개선:**
    
    - 변수명을 `_score`로 한 것은 내부 상태임을 암시합니다. 아직 특별히 개선할 점은 보이지 않습니다.
        

### 3단계: 스페어(Spare) 처리하기

이제 복잡성이 증가합니다. 스페어 보너스를 계산해야 합니다.

- **[RED] 실패하는 테스트 작성:**
    
    - **목표:** 스페어 하나를 처리한 경우, 보너스 점수가 정확히 계산되어야 한다.
        
    - **시나리오:** `5, 5` (스페어), 다음 투구 `3`, 나머지 17번은 `0`.
        
    - **예상 점수:** (첫 프레임: 10 + 보너스 3) + (두 번째 프레임: 3) = 16
        
    - **테스트 코드:**
        
        ```
        class BowlingGameTest:
            # ...
            def test_one_spare(self):
                game = Game()
                game.roll(5)
                game.roll(5) # Spare
                game.roll(3)
                # 나머지 17번은 0점
                for i in range(17):
                    game.roll(0)
                assert game.score() == 16
        ```
        
    - **결과:** 현재 `score()`는 단순히 모든 핀을 더하므로 `5+5+3 = 13`을 반환합니다. 테스트는 실패합니다 (`AssertionError: 16 != 13`). **RED** 입니다.
        
- **[GREEN] 테스트 통과시키기:**
    
    - **목표:** 스페어 보너스 로직을 추가해야 합니다. 이제 단순히 점수를 더하는 방식으로는 안됩니다. 투구 기록 전체를 저장해야 합니다.
        
    - **실제 코드 (리팩토링 포함):**
        
        ```
        class Game:
            def __init__(self):
                self.rolls = [] # 모든 투구를 저장
        
            def roll(self, pins):
                self.rolls.append(pins)
        
            def score(self):
                total_score = 0
                roll_index = 0
                for frame in range(10): # 10 프레임을 순회
                    # 스페어인 경우
                    if self.rolls[roll_index] + self.rolls[roll_index + 1] == 10:
                        total_score += 10 + self.rolls[roll_index + 2]
                        roll_index += 2
                    else:
                        total_score += self.rolls[roll_index] + self.rolls[roll_index + 1]
                        roll_index += 2
                return total_score
        ```
        
    - **결과:** 이 코드는 `test_one_spare`를 통과합니다. 기존 테스트들도 다시 돌려봅니다.
        
        - `test_gutter_game`: 0+0=0, 10번 반복 -> 통과
            
        - test_all_ones: 1+1=2, 10번 반복 -> 통과
            
            모든 테스트가 통과합니다. GREEN 입니다.
            
- **[REFACTOR] 코드 개선:**
    
    - `score` 메서드가 복잡해지기 시작했습니다. 스페어와 일반 프레임을 구분하는 로직을 별도의 헬퍼 메서드로 추출하여 가독성을 높일 수 있습니다.
        
    - **리팩토링 후 코드:**
        
        ```
        class Game:
            # ... __init__, roll ...
        
            def score(self):
                total_score = 0
                roll_index = 0
                for frame in range(10):
                    if self._is_spare(roll_index):
                        total_score += 10 + self._spare_bonus(roll_index)
                        roll_index += 2
                    else:
                        total_score += self._frame_score(roll_index)
                        roll_index += 2
                return total_score
        
            def _is_spare(self, roll_index):
                return self.rolls[roll_index] + self.rolls[roll_index + 1] == 10
        
            def _spare_bonus(self, roll_index):
                return self.rolls[roll_index + 2]
        
            def _frame_score(self, roll_index):
                return self.rolls[roll_index] + self.rolls[roll_index + 1]
        ```
        
    - 코드가 더 명확해지고 각 메서드가 한 가지 일만 하게 되었습니다.
        

### 4단계: 스트라이크(Strike) 처리하기

- **[RED] 실패하는 테스트 작성:**
    
    - **목표:** 스트라이크 하나를 처리한 경우, 보너스 점수가 정확히 계산되어야 한다.
        
    - **시나리오:** `10` (스트라이크), 다음 투구 `3`, `4`, 나머지 16번은 `0`.
        
    - **예상 점수:** (첫 프레임: 10 + 보너스 3+4) + (두 번째 프레임: 3+4) = 17 + 7 = 24
        
    - **테스트 코드:**
        
        ```
        class BowlingGameTest:
            # ...
            def test_one_strike(self):
                game = Game()
                game.roll(10) # Strike
                game.roll(3)
                game.roll(4)
                # 나머지 16번은 0점 (스트라이크는 1프레임에 1투구)
                for i in range(16):
                    game.roll(0)
                assert game.score() == 24
        ```
        
    - **결과:** 현재 코드는 스트라이크를 스페어처럼 취급하거나 인덱스 에러를 발생시킵니다. 테스트는 실패합니다. **RED** 입니다.
        
- **[GREEN] & [REFACTOR] 테스트 통과시키기:**
    
    - `score` 메서드를 수정하여 스트라이크를 인식하고, 프레임당 투구 횟수가 1회 또는 2회로 가변적임을 처리해야 합니다.
        
    - **개선된 코드:**
        
        ```
        class Game:
            # ... __init__, roll ...
        
            def score(self):
                total_score = 0
                roll_index = 0
                for frame in range(10):
                    if self._is_strike(roll_index): # 스트라이크 먼저 체크
                        total_score += 10 + self._strike_bonus(roll_index)
                        roll_index += 1 # 스트라이크는 1롤만 이동
                    elif self._is_spare(roll_index):
                        total_score += 10 + self._spare_bonus(roll_index)
                        roll_index += 2
                    else:
                        total_score += self._frame_score(roll_index)
                        roll_index += 2
                return total_score
        
            def _is_strike(self, roll_index):
                return self.rolls[roll_index] == 10
        
            def _strike_bonus(self, roll_index):
                return self.rolls[roll_index + 1] + self.rolls[roll_index + 2]
        
            # ... _is_spare, _spare_bonus, _frame_score ...
        ```
        
    - **결과:** 모든 테스트를 다시 실행합니다. 모두 통과하면 **GREEN** 입니다.
        

### 5단계: 퍼펙트 게임

궁극의 테스트 케이스입니다. 모든 경계 조건을 시험합니다.

- **[RED] 실패하는 테스트 작성:**
    
    - **목표:** 12번 모두 스트라이크를 친 경우, 점수는 300점이어야 한다. (10 프레임 * (10 + 10 + 10))
        
    - **테스트 코드:**
        
        ```
        class BowlingGameTest:
            # ...
            def test_perfect_game(self):
                game = Game()
                # 12번의 스트라이크
                for i in range(12):
                    game.roll(10)
                assert game.score() == 300
        ```
        
    - **결과:** 현재 코드는 10번째 프레임 이후의 보너스 롤을 처리하면서 `IndexError`를 발생시킬 것입니다. 테스트는 실패합니다. **RED** 입니다.
        
- **[GREEN] & [REFACTOR] 테스트 통과시키기:**
    
    - `score` 메서드의 루프가 `roll_index`를 안전하게 다루는지 확인하고, 보너스 계산 시 배열의 범위를 벗어나지 않도록 수정합니다. 코드가 이미 잘 구조화되어 있다면, 수정은 `_strike_bonus`나 `_spare_bonus` 메서드에 집중될 것입니다. 이 과정을 통해 코드는 더욱 견고해집니다.
        

## IV. 카타를 통해 배우는 것들

- **작은 단계의 힘:** 가장 간단한 케이스에서 시작하여 점진적으로 복잡성을 추가하는 것이 얼마나 강력하고 안전한 방법인지 깨닫게 됩니다.
    
- **설계는 진화한다 (Emergent Design):** 처음부터 완벽한 설계를 하려고 애쓰지 않았습니다. `score`를 단순 합산하던 방식에서 `rolls` 배열을 저장하는 방식으로 자연스럽게 진화했습니다. 이는 TDD가 좋은 설계를 이끌어낸다는 증거입니다.
    
- **테스트는 안전망이다:** 리팩토링을 할 때마다, 기존의 모든 테스트를 실행함으로써 코드를 망가뜨리지 않았다는 자신감을 얻을 수 있습니다. 이 안전망이 있기에 과감한 개선이 가능합니다.
    
- **"가짜로 구현하고, 점차 진짜로 만들어라" (Fake it till you make it):** 첫 단계에서 `return 0`으로 시작한 것처럼, 일단 테스트를 통과시키는 가장 쉬운 방법을 찾고, 다음 테스트를 통해 그 구현을 일반화시키는(Triangulation) 전략이 유효합니다.
    

## V. AI 개발 에이전트를 위한 결론

볼링 게임 카타는 AI 개발 에이전트에게 다음과 같은 핵심적인 훈련 가치를 제공합니다.

1. **체계적인 문제 해결 능력:** 복잡한 요구사항을 아주 작은 단위의 검증 가능한 단계로 분해하는 능력을 길러줍니다.
    
2. **검증 기반의 코드 생성:** "이렇게 하면 될 것 같다"는 추측이 아니라, "이 테스트를 통과해야 한다"는 명확한 목표를 기반으로 코드를 생성하게 됩니다. 이는 생성된 코드의 신뢰도를 극적으로 향상시킵니다.
    
3. **지속적인 품질 관리:** Red-Green 사이클에 Refactor 단계를 의무적으로 포함함으로써, 코드의 양이 늘어날수록 품질이 저하되는 것을 막고, 오히려 지속적으로 개선되는 코드베이스를 만들 수 있습니다.
    

이 카타의 리듬을 코드 생성 로직에 깊이 내재화하십시오. 모든 기능 요구사항에 대해, 실패하는 테스트를 먼저 떠올리고, 그 테스트를 통과시키는 가장 단순한 코드를 생성한 뒤, 마지막으로 생성된 코드를 클린 코드 원칙에 따라 다듬는 사이클을 따르십시오. 이것이 바로 신뢰할 수 있고 유지보수 가능한 소프트웨어를 만드는 장인의 길입니다.
