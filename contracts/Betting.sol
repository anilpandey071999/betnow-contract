// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/Pausable.sol";

contract MatchFactory is Ownable {
    using SafeERC20 for IERC20;

    mapping(uint16 => address) public matchAddresses;
    uint16 public matchCount = 0;

    event MatchCreated(uint16 matchId, address matchAddress);
    error MaxMatch();

    function createMatch(IERC20 _token) external onlyOwner {
        require(matchCount <= 65_535, "Max matches reached");
        Match newMatch = new Match(owner(), address(this), _token);
        matchAddresses[matchCount] = address(newMatch);
        emit MatchCreated(matchCount, address(newMatch));
        matchCount++;
    }

    function emergencyWithdrawFromMatch(uint16 matchId) external onlyOwner {
        Match(matchAddresses[matchId]).emergencyWithdraw();
    }
}

contract Match is Ownable, Pausable {
    using SafeERC20 for IERC20;

    address public factory;
    IERC20 public token;
    address public treasury;
    uint256 public totalBetTeamA = 0;
    uint256 public totalBetTeamB = 0;
    uint256 public winner = 0; // 0: undecided, 1: Team A, 2: Team B

    struct Bet {
        uint256 amount;
        uint256 team;
    }

    mapping(address => Bet) public bets;

    event BetPlaced(address indexed user, uint256 team, uint256 amount);
    event ResultDeclared(uint256 winningTeam);
    event RewardClaimed(address indexed user, uint256 amount);

    constructor(address _owner, address _factory, IERC20 _token) {
        transferOwnership(_owner);
        treasury = _owner;
        factory = _factory;
        token = _token;
    }

    modifier onlyFactory() {
        require(msg.sender == factory, "Only Factory can call");
        _;
    }

    function Pause() external onlyOwner {
        _pause();
    }

    function Unpause() external onlyOwner {
        _unpause();
    }

    function bet(uint256 team, uint256 amount) public whenNotPaused {
        require(winner == 0, "Betting closed");
        require(team == 1 || team == 2, "Invalid team");
        require(bets[msg.sender].amount == 0, "User already bet");

        token.safeTransferFrom(msg.sender, address(this), amount);

        if (team == 1) {
            totalBetTeamA += amount;
        } else {
            totalBetTeamB += amount;
        }

        // treasury += (amount * 25) / 100;

        bets[msg.sender] = Bet({amount: amount, team: team});
        emit BetPlaced(msg.sender, team, amount);
    }

    function declareResult(uint256 winningTeam) external onlyOwner {
        require(winningTeam == 1 || winningTeam == 2, "Invalid team");
        require(winner == 0, "Result already declared");
        winner = winningTeam;

        uint256 loserPool = (winner == 1) ? totalBetTeamB : totalBetTeamA;
        uint256 treasuryFee = (loserPool * 25) / 100;
        (winner == 1)
            ? totalBetTeamB = totalBetTeamB - treasuryFee
            : totalBetTeamA = totalBetTeamA - treasuryFee;
        token.safeTransfer(treasury, treasuryFee);
        emit ResultDeclared(winningTeam);
    }

    function claimReward() external {
        require(winner > 0, "Match not decided");
        Bet storage userBet = bets[msg.sender];
        require(userBet.team == winner, "Incorrect team");
        require(userBet.amount > 0, "No bet placed or reward already claimed");

        uint256 winningPool = (winner == 1) ? totalBetTeamA : totalBetTeamB;
        uint256 loserPool = (winner == 1) ? totalBetTeamB : totalBetTeamA;
        uint256 rewardRatio = (userBet.amount * 1e18) / winningPool;
        uint256 reward = (loserPool  * rewardRatio) / 1e18;

        uint256 totalReward = userBet.amount + reward;
        token.safeTransfer(msg.sender, totalReward);
        emit RewardClaimed(msg.sender, totalReward);

        userBet.amount = 0; // Reset the user's bet to prevent double claim.
    }

    function emergencyWithdraw() external onlyFactory {
        token.safeTransfer(owner(), token.balanceOf(address(this)));
    }
}
