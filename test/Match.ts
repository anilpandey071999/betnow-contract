import { expect } from "chai";
import { ethers } from "hardhat";
import {
  Token__factory,
  Token,
  MatchFactory__factory,
  MatchFactory,
  Match__factory,
  Match,
} from "../typechain-types";
const { formatEther, parseEther } = ethers;

describe("Match", function () {
  async function deployBetting(needBetting: Boolean) {
    const [owner, addr1, addr2, otherAccount] = await ethers.getSigners();

    const TestToken: Token__factory = await ethers.getContractFactory("Token");
    const testToken: Token = await TestToken.deploy();

    await testToken.transfer(addr1, parseEther("10"));

    const BettingFactory: MatchFactory__factory =
      await ethers.getContractFactory("MatchFactory");
    const bettingFactory: MatchFactory = await BettingFactory.deploy();

    if (needBetting) {
      const CreateMatch = await bettingFactory.createMatch(
        await testToken.getAddress()
      );
      await CreateMatch.wait();

      const getMatchAddress = await bettingFactory.matchAddresses(0);
      const bettingMatch: Match = await ethers.getContractAt(
        "Match",
        getMatchAddress,
        owner
      );

      await testToken.transfer(addr1, parseEther("10"));
      await testToken.transfer(addr2, parseEther("10"));
      await testToken.transfer(otherAccount, parseEther("10"));

      await testToken.connect(owner).approve(getMatchAddress, parseEther("10"));
      await testToken.connect(addr1).approve(getMatchAddress, parseEther("10"));
      await testToken.connect(addr2).approve(getMatchAddress, parseEther("10"));
      await testToken
        .connect(otherAccount)
        .approve(getMatchAddress, parseEther("10"));
      return {
        owner,
        addr1,
        addr2,
        otherAccount,
        testToken,
        bettingFactory,
        bettingMatch,
      };
    }
    return {
      owner,
      addr1,
      addr2,
      otherAccount,
      testToken,
      bettingFactory,
    };
  }

  it("Successfully creates a new Match instance", async function () {
    const { owner, addr1, addr2, otherAccount, testToken, bettingFactory } =
      await deployBetting(false);

    await bettingFactory.createMatch(addr1.address);
    const matchAddress = await bettingFactory.matchAddresses(0);

    // Use MatchFactory to attach because it's the factory for the Match contract
    const matchInstance: Match = await ethers.getContractAt(
      "Match",
      matchAddress
    );

    expect(await matchInstance.factory()).to.equal(
      await bettingFactory.getAddress()
    );
  });

  describe("Betting Functionality", function () {
    it("Accepts valid bets", async function () {
      const {
        owner,
        addr1,
        addr2,
        otherAccount,
        testToken,
        bettingFactory,
        bettingMatch,
      } = await deployBetting(true);

      await expect(await bettingMatch?.connect(addr1).bet(1, 1000))
        .to.emit(bettingMatch, "BetPlaced")
        .withArgs(await addr1.getAddress(), 1, 1000);

      const matchContractAddress = (await bettingMatch?.getAddress()) || "";
      expect(await testToken.balanceOf(matchContractAddress)).to.equal(1000);
    });

    it("Restricts users from placing multiple bets", async function () {
      const { addr1, testToken, bettingMatch } = await deployBetting(true);

      await expect(bettingMatch?.connect(addr1).bet(1, 1000))
        .to.emit(bettingMatch, "BetPlaced")
        .withArgs(await addr1.getAddress(), 1, 1000);

      const matchContractAddress = (await bettingMatch?.getAddress()) || "";
      expect(await testToken.balanceOf(matchContractAddress)).to.equal(1000);
      await expect(
        bettingMatch?.connect(addr1).bet(1, 1000)
      ).to.be.rejectedWith("User already bet");
    });

    it("Rejects bets for non-existent teams ", async function () {
      const { addr1, bettingMatch } = await deployBetting(true);

      await expect(
        bettingMatch?.connect(addr1).bet(3, 1000)
      ).to.be.rejectedWith("Invalid team");
    });

    it("Prohibits bets once the match is paused", async function () {
      const { owner, addr1, addr2, testToken, bettingMatch } =
        await deployBetting(true);

      await expect(bettingMatch?.connect(addr1).bet(1, 1000))
        .to.emit(bettingMatch, "BetPlaced")
        .withArgs(await addr1.getAddress(), 1, 1000);

      const matchContractAddress = (await bettingMatch?.getAddress()) || "";
      expect(await testToken.balanceOf(matchContractAddress)).to.equal(1000);

      await expect(bettingMatch?.Pause())
        .to.emit(bettingMatch, "Paused")
        .withArgs(await owner.getAddress());

      await expect(bettingMatch?.connect(addr2).bet(1, 1000)).to.rejected;
    });

    it("Denies bets after the result has been declared", async function () {
      const { owner, addr1, addr2, testToken, bettingMatch } =
        await deployBetting(true);

      await expect(bettingMatch?.connect(addr1).bet(1, 1000))
        .to.emit(bettingMatch, "BetPlaced")
        .withArgs(await addr1.getAddress(), 1, 1000);

      const matchContractAddress = (await bettingMatch?.getAddress()) || "";
      expect(await testToken.balanceOf(matchContractAddress)).to.equal(1000);

      await expect(bettingMatch?.declareResult(1))
        .to.emit(bettingMatch, "ResultDeclared")
        .withArgs(1);

      await expect(bettingMatch?.connect(addr2).bet(1, 1000)).to.rejected;
    });
  });

  describe("Result Declaration", async function () {
    it("Allows legitimate result declaration", async function () {
      const { bettingMatch } = await deployBetting(true);
      await expect(bettingMatch?.declareResult(1))
        .to.emit(bettingMatch, "ResultDeclared")
        .withArgs(1);

      expect(await bettingMatch?.winner()).to.equal(1);
    });

    it("Declines result declaration for invalid teams", async function () {
      const { bettingMatch } = await deployBetting(true);
      await expect(bettingMatch?.declareResult(3)).to.be.rejected;
    });

    it("Blocks multiple result declarations", async function () {
      const { bettingMatch } = await deployBetting(true);
      await expect(bettingMatch?.declareResult(1))
        .to.emit(bettingMatch, "ResultDeclared")
        .withArgs(1);

      await expect(bettingMatch?.declareResult(2)).to.be.rejectedWith(
        "Result already declared"
      );
    });

    it("Ensures only the contract owner can declare the result", async function () {
      const { bettingMatch, addr1 } = await deployBetting(true);

      await expect(
        bettingMatch?.connect(addr1).declareResult(2)
      ).to.be.rejectedWith("Ownable: caller is not the owner");
    });
  });

  describe("Claiming Rewards", function () {
    it("Should allow users who bet on the winning team to claim rewards", async function () {
      const { addr1, bettingMatch, testToken } = await deployBetting(true);

      await bettingMatch?.connect(addr1).bet(1, parseEther("5"));
      await bettingMatch?.declareResult(1);

      await bettingMatch?.connect(addr1).claimReward();
      expect(await testToken.balanceOf(addr1.address)).to.be.above(
        parseEther("5")
      ); // Should have more than original bet due to reward
    });

    it("Shouldn't allow users who bet on the losing team to claim rewards", async function () {
      const { addr1, bettingMatch } = await deployBetting(true);

      await bettingMatch?.connect(addr1).bet(2, parseEther("5")); // Assuming 2 is the losing team
      await bettingMatch?.declareResult(1);

      await expect(
        bettingMatch?.connect(addr1).claimReward()
      ).to.be.rejectedWith("Incorrect team");
    });

    it("Shouldn't allow users to claim before result declaration", async function () {
      const { addr1, bettingMatch } = await deployBetting(true);

      await bettingMatch?.connect(addr1).bet(1, parseEther("5"));

      await expect(
        bettingMatch?.connect(addr1).claimReward()
      ).to.be.rejectedWith("Match not decided");
    });

    it("Should reset user's bet after claiming", async function () {
      const { addr1, bettingMatch } = await deployBetting(true);

      await bettingMatch?.connect(addr1).bet(1, parseEther("5"));
      await bettingMatch?.declareResult(1);

      await bettingMatch?.connect(addr1).claimReward();
      const userBet = await bettingMatch?.bets(addr1.address);
      expect(userBet?.amount).to.equal(0);
    });

    it("Reward calculation should be correct", async function () {
      const { owner, addr1, addr2, bettingMatch, testToken } =
        await deployBetting(true);

      await bettingMatch?.connect(addr1).bet(1, parseEther("5"));
      await bettingMatch?.connect(addr2).bet(2, parseEther("5"));
      // console.log(formatEther((await testToken.balanceOf(owner.address)).toString()));
      await bettingMatch?.declareResult(1);
      // console.log(formatEther((await testToken.balanceOf(owner.address)).toString()));

      const initialBalance = Number(await testToken.balanceOf(addr1.address));
      await bettingMatch?.connect(addr1).claimReward();
      const finalBalance = Number(await testToken.balanceOf(addr1.address));

      // Given the logic in the contract, adjust the expectedReward calculation accordingly
      const expectedReward =
        Number(parseEther("5")) + 0.75 * Number(parseEther("5")); // Adjust this based on the logic
      expect(finalBalance - initialBalance).to.equal(expectedReward);
    });
  });

  describe("Emergency Withdraw From Match", function () {
    it("Should be able to withdraw", async function () {
      const { addr1, addr2, owner, bettingFactory, bettingMatch, testToken } =
        await deployBetting(true);
      await bettingMatch?.connect(addr1).bet(1, parseEther("5"));
      await bettingMatch?.connect(addr2).bet(2, parseEther("5"));

      const ownerBalanceBefore = formatEther(
        await testToken.balanceOf(owner.address)
      );
      await bettingFactory?.emergencyWithdrawFromMatch(0);
      const ownerBalanceAfter = formatEther(
        await testToken.balanceOf(owner.address)
      );

      expect(Number(ownerBalanceAfter)).to.be.greaterThan(
        Number(ownerBalanceBefore)
      );
    });

    it("Shouldn't allow withdraw from non onwer", async function () {
      const { addr1, addr2, owner, bettingFactory, bettingMatch, testToken } =
        await deployBetting(true);
      await bettingMatch?.connect(addr1).bet(1, parseEther("5"));
      await bettingMatch?.connect(addr2).bet(2, parseEther("5"));

      await expect(bettingFactory?.connect(addr2).emergencyWithdrawFromMatch(0))
        .to.be.rejected;
    });
  });
});
