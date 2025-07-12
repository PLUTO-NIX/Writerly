"""
로깅 설정 유틸리티
"""

import logging
import logging.handlers
import os
from config import Config


def setup_logger(name=None, level=None, log_file=None):
    """
    로거 설정
    
    Args:
        name (str): 로거 이름 (None이면 루트 로거)
        level (str): 로그 레벨 (DEBUG, INFO, WARNING, ERROR, CRITICAL)
        log_file (str): 로그 파일 경로
        
    Returns:
        logging.Logger: 설정된 로거 인스턴스
    """
    
    # 로거 생성
    logger = logging.getLogger(name)
    
    # 로그 레벨 설정
    log_level = level or Config.LOG_LEVEL
    logger.setLevel(getattr(logging, log_level.upper(), logging.INFO))
    
    # 기존 핸들러 제거 (중복 방지)
    logger.handlers.clear()
    
    # 포맷터 설정
    formatter = logging.Formatter(
        '%(asctime)s - %(name)s - %(levelname)s - %(message)s'
    )
    
    # 콘솔 핸들러 추가
    console_handler = logging.StreamHandler()
    console_handler.setFormatter(formatter)
    logger.addHandler(console_handler)
    
    # 파일 핸들러 추가 (로그 파일 지정된 경우)
    if log_file or Config.LOG_FILE:
        file_path = log_file or Config.LOG_FILE
        
        # 로그 디렉토리 생성
        log_dir = os.path.dirname(file_path)
        if log_dir and not os.path.exists(log_dir):
            os.makedirs(log_dir)
        
        # 회전 파일 핸들러 (최대 10MB, 5개 파일)
        file_handler = logging.handlers.RotatingFileHandler(
            file_path,
            maxBytes=10 * 1024 * 1024,  # 10MB
            backupCount=5
        )
        file_handler.setFormatter(formatter)
        logger.addHandler(file_handler)
    
    return logger


# 기본 로거 설정
default_logger = setup_logger('writerly') 