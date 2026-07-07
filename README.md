콕링 재고관리 사용법

index.html을 브라우저로 열어 사용합니다.

입력 순서





상품에서 상품명, 옵션, 공급처, 기본 판매가, 재주문 기준을 등록합니다.



입고에서 수량, 통화, 매입가, 환율, 배송비를 입력합니다.



비용에서 포장비, 로고 제작비, 관세, 배송비 등을 등록하고 배분 방식을 선택합니다.



판매에서 주문별 판매가, 할인, 받은 배송비, 실제 택배비, 포장비, 수수료를 입력합니다.



재고/마진에서 현재 재고, 평균 원가, 예상 마진, 마진율을 확인합니다.

저장과 백업





Supabase 설정 전에는 데이터가 브라우저에 자동 저장됩니다.



Supabase 설정 후에는 로그인한 계정의 클라우드 데이터로 동기화됩니다.



백업 내보내기로 JSON 파일을 저장해두면 다른 브라우저나 PC에서 백업 가져오기로 복원할 수 있습니다.



CSV 다운로드는 재고/마진 표를 엑셀에서 열 수 있는 파일로 저장합니다.

Supabase 동기화 설정





Supabase에서 새 프로젝트를 만듭니다.



Supabase SQL Editor에서 supabase-schema.sql 내용을 실행합니다.



Supabase Authentication > Providers에서 Email 로그인을 켭니다.



Supabase Project Settings > API에서 Project URL과 anon public key를 복사합니다.



supabase-config.js 파일에 아래처럼 붙여넣습니다.

window.KOKRING_SUPABASE = {
  url: "https://프로젝트아이디.supabase.co",
  anonKey: "복사한 anon public key"
};





GitHub에 수정된 파일을 다시 업로드합니다.



사이트에서 이메일/비밀번호로 회원가입 또는 로그인합니다.

같은 계정으로 노트북과 핸드폰에서 로그인하면 같은 재고 데이터가 보입니다.
